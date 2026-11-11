import json
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.local.preservation import restore_sqlite_copy, verify_snapshot
from app.local.runtime import LocalRuntime


def previous_database(path):
    runtime = LocalRuntime(path, "http://127.0.0.1:5174", "synthetic-preservation-bootstrap-token")
    with runtime.engine.connect().execution_options(sqlite_write=True) as connection:
        config = Config("alembic.local.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, "local_0002")
        organization, actor, event = uuid4(), uuid4(), uuid4().hex
        connection.execute(
            text("INSERT INTO organizations (id,name,version) VALUES (:id,'Synthetic',1)"),
            {"id": organization.hex},
        )
        connection.execute(
            text(
                "INSERT INTO audit_events (id,organization_id,actor_id,action,record_id) "
                "VALUES (:id,:org,:actor,'historical.synthetic',:record)"
            ),
            {"id": event, "org": organization.hex, "actor": actor.hex, "record": uuid4().hex},
        )
        connection.execute(
            text(
                "INSERT INTO memberships (organization_id,user_id,role,active) "
                "VALUES (:org,:actor,'administrator',1)"
            ),
            {"org": organization.hex, "actor": actor.hex},
        )
        connection.execute(
            text(
                "INSERT INTO local_installation (id,organization_id,user_id) VALUES (1,:org,:actor)"
            ),
            {"org": str(organization), "actor": str(actor)},
        )
        connection.execute(
            text("INSERT INTO local_capture_store (id,revision,data) VALUES (1,0,:data)"),
            {"data": json.dumps({"files": [], "drafts": [], "payments": []})},
        )
        connection.commit()
    (runtime.files / "original.txt").write_bytes(b"synthetic historical original")
    return runtime, event


def test_copy_precedes_migration_preserves_history_and_restores_without_overwriting(tmp_path):
    runtime, event = previous_database(tmp_path / "installation")
    runtime.initialize()
    copies = list((runtime.directory / "migration-snapshots").iterdir())
    assert len(copies) == 1
    manifest = verify_snapshot(copies[0])
    assert manifest["external_backup"] == "pending"
    assert manifest["schema_revisions"] == ["local_0002"]
    restored = restore_sqlite_copy(copies[0], tmp_path / "recovered")
    assert (restored / "attachments/original.txt").read_bytes() == b"synthetic historical original"
    with pytest.raises(FileExistsError):
        restore_sqlite_copy(copies[0], restored)
    with runtime.engine.connect() as connection:
        row = (
            connection.execute(text("SELECT * FROM audit_events WHERE id=:id"), {"id": event})
            .mappings()
            .one()
        )
        assert row["schema_version"] == 1
        for field in ("operation_id", "occurred_at_utc", "reason", "values_before", "values_after"):
            assert row[field] is None
    runtime.close()
    runtime.initialize()
    assert len(list((runtime.directory / "migration-snapshots").iterdir())) == 1
    runtime.close()


def test_failed_copy_aborts_migration_and_keeps_existing_files(tmp_path, monkeypatch):
    from app.local import preservation

    runtime, _ = previous_database(tmp_path)

    def fail(*args):
        raise OSError("Synthetic full disk while copying attachments")

    monkeypatch.setattr(preservation, "copy_documents", fail)
    with pytest.raises(OSError):
        runtime.initialize()
    with runtime.engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "local_0002"
    assert (runtime.files / "original.txt").read_bytes() == b"synthetic historical original"
    runtime.close()


def test_broken_references_stop_before_ddl_or_copy(tmp_path):
    runtime, _ = previous_database(tmp_path)
    import sqlite3

    with sqlite3.connect(tmp_path / "agrocontrol.sqlite3") as connection:
        connection.execute(
            "INSERT INTO customers (id,organization_id,name,active,version) VALUES (?,?,?,1,1)",
            (uuid4().hex, uuid4().hex, "broken synthetic reference"),
        )
    with pytest.raises(RuntimeError, match="Integrity"):
        runtime.initialize()
    assert not (tmp_path / "migration-snapshots").exists()
    runtime.close()


def test_snapshot_verification_rejects_changed_document(tmp_path):
    runtime, _ = previous_database(tmp_path / "installation")
    runtime.initialize()
    snapshot = next((runtime.directory / "migration-snapshots").iterdir())
    manifest = json.loads((snapshot / "manifest.json").read_text())
    (snapshot / manifest["documents"][0]["path"]).write_bytes(b"changed")
    with pytest.raises(RuntimeError, match="corrupt"):
        verify_snapshot(snapshot)
    assert not (tmp_path / "not-restored").exists()
    with pytest.raises(RuntimeError):
        restore_sqlite_copy(snapshot, tmp_path / "not-restored")
    runtime.close()


def test_deep_document_copy_and_restored_database_keep_original_identity(tmp_path):
    import hashlib
    import sqlite3

    from app.local.preservation import disk_path

    runtime, _ = previous_database(tmp_path / "installation")
    with runtime.engine.connect() as connection:
        org, actor = connection.execute(
            text("SELECT organization_id,user_id FROM local_installation")
        ).one()
    customer_id, order_id, document_id = uuid4(), uuid4(), uuid4()
    content = b"%PDF-1.7 synthetic recoverable historical original"
    with runtime.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO customers (id,organization_id,name,active,version) "
                "VALUES (:id,:org,'Synthetic preserved customer',1,1)"
            ),
            {"id": customer_id.hex, "org": UUID(org).hex},
        )
        connection.execute(
            text(
                "INSERT INTO orders (id,organization_id,customer_id,created_by,product_type,"
                "total_amount,version,remission_number) "
                "VALUES (:id,:org,:customer,:actor,'carrot','1.23450000',1,99)"
            ),
            {
                "id": order_id.hex,
                "org": UUID(org).hex,
                "customer": customer_id.hex,
                "actor": UUID(actor).hex,
            },
        )
        connection.execute(
            text(
                "INSERT INTO order_carrot_details (order_id,organization_id,hectares,unit_price) "
                "VALUES (:id,:org,10000,12345)"
            ),
            {"id": order_id.hex, "org": UUID(org).hex},
        )
        connection.execute(
            text(
                "INSERT INTO attachments (id,organization_id,order_id,filename,size_bytes,"
                "sha256,status) VALUES (:id,:org,:order_id,'original.pdf',:size,:sha,'ready')"
            ),
            {
                "id": document_id.hex,
                "org": UUID(org).hex,
                "order_id": order_id.hex,
                "size": len(content),
                "sha": hashlib.sha256(content).hexdigest(),
            },
        )
    relative = f"{org}/{order_id}/{document_id}"
    original = runtime.files / relative
    original.parent.mkdir(parents=True)
    original.write_bytes(content)
    runtime.initialize()
    assert str(runtime.principal.organization_id) == org
    preserved = next((runtime.directory / "migration-snapshots").iterdir())
    recovered = restore_sqlite_copy(preserved, tmp_path / "recovered")
    assert disk_path(recovered / "attachments" / relative).read_bytes() == content
    with sqlite3.connect(recovered / "agrocontrol.sqlite3") as connection:
        assert (
            connection.execute("SELECT organization_id FROM local_installation").fetchone()[0]
            == org
        )
        assert connection.execute("SELECT total_amount FROM orders").fetchone()[0] == "1.23450000"
    assert original.read_bytes() == content
    runtime.close()


@pytest.mark.parametrize("corrupt", [False, True])
def test_missing_or_corrupt_ready_document_blocks_schema_upgrade(tmp_path, corrupt):
    import hashlib

    runtime, _ = previous_database(tmp_path)
    identifier = str(uuid4())
    with runtime.engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO local_blobs (id,filename,size_bytes,sha256,ready) "
                "VALUES (:id,'original.txt',1,:sha,1)"
            ),
            {"id": identifier, "sha": hashlib.sha256(b"x").hexdigest()},
        )
    if corrupt:
        (runtime.files / "staged").mkdir()
        (runtime.files / "staged" / identifier).write_bytes(b"wrong")
    with pytest.raises(RuntimeError, match="confirmed document"):
        runtime.initialize()
    with runtime.engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "local_0002"
    assert not (runtime.directory / "migration-snapshots").exists()
    runtime.close()


def test_preservation_does_not_copy_into_its_own_source(tmp_path):
    from app.local.preservation import copy_documents

    source = tmp_path / "documents"
    source.mkdir()
    (source / "original.txt").write_bytes(b"synthetic original")
    with pytest.raises(RuntimeError, match="outside"):
        copy_documents(source, source / "recursive-target")
    assert not (source / "recursive-target").exists()

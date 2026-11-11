from pathlib import Path
from types import SimpleNamespace

import pytest

from app.local.preservation import verify_snapshot
from app.persistence import preservation


def synthetic_postgres(monkeypatch, tmp_path, *, dump_fails=False):
    source = tmp_path / "documents"
    source.mkdir()
    (source / "synthetic.txt").write_bytes(b"synthetic source bytes")
    calls = []
    inspector = SimpleNamespace(
        get_table_names=lambda: ["customers", "attachments"], get_foreign_keys=lambda table: []
    )
    scripts = SimpleNamespace(
        get_revision=lambda revision: revision, get_heads=lambda: ["0009_audit_operations"]
    )
    monkeypatch.setattr(
        preservation.MigrationContext,
        "configure",
        lambda connection: SimpleNamespace(get_current_heads=lambda: ("0008_reusable_remissions",)),
    )
    monkeypatch.setattr(preservation.ScriptDirectory, "from_config", lambda config: scripts)
    monkeypatch.setattr(preservation, "inspect", lambda connection: inspector)
    monkeypatch.setattr(
        preservation,
        "get_settings",
        lambda: SimpleNamespace(
            private_files_path=source,
            database_url="postgresql+psycopg://synthetic:synthetic-test-only@localhost/agrocontrol_test",
        ),
    )
    monkeypatch.setattr(preservation.shutil, "which", lambda program: program)
    monkeypatch.setenv("AGROCONTROL_PRESERVATION_DIR", str(tmp_path / "copies"))
    monkeypatch.setenv("AGROCONTROL_PG_MAINTENANCE", "true")

    def run(arguments, **options):
        calls.append((arguments, options))
        if arguments[0] == "pg_dump":
            if dump_fails:
                return SimpleNamespace(returncode=1)
            Path(arguments[arguments.index("--file") + 1]).write_bytes(
                b"synthetic archive, not a real PostgreSQL dump"
            )
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(preservation.subprocess, "run", run)
    connection = SimpleNamespace(
        dialect=SimpleNamespace(
            identifier_preparer=SimpleNamespace(quote=lambda identifier: f'"{identifier}"')
        ),
        exec_driver_sql=lambda sql: calls.append((sql, {})),
        scalar=lambda sql: "synthetic-exported-snapshot" if "pg_export_snapshot" in str(sql) else 0,
        execute=lambda sql: SimpleNamespace(mappings=lambda: []),
    )
    return connection, calls, source


def test_postgresql_upgrade_requires_maintenance_before_copy_tools(monkeypatch, tmp_path):
    connection, calls, source = synthetic_postgres(monkeypatch, tmp_path)
    monkeypatch.delenv("AGROCONTROL_PG_MAINTENANCE")
    with pytest.raises(RuntimeError, match="MAINTENANCE"):
        preservation.before_postgresql_upgrade(connection, None)
    assert not calls
    assert (source / "synthetic.txt").read_bytes() == b"synthetic source bytes"


def test_postgresql_dump_failure_stops_before_migration_and_keeps_sources(monkeypatch, tmp_path):
    connection, calls, source = synthetic_postgres(monkeypatch, tmp_path, dump_fails=True)
    with pytest.raises(RuntimeError, match="pg_dump failed"):
        preservation.before_postgresql_upgrade(connection, None)
    assert (source / "synthetic.txt").read_bytes() == b"synthetic source bytes"
    assert not list((tmp_path / "copies").rglob("manifest.json"))
    assert any(isinstance(arguments, str) and "SHARE MODE" in arguments for arguments, _ in calls)


def test_postgresql_copy_protocol_uses_exported_snapshot_and_verified_file_manifest(
    monkeypatch, tmp_path
):
    connection, calls, source = synthetic_postgres(monkeypatch, tmp_path)
    preservation.before_postgresql_upgrade(connection, None)
    directory = next((tmp_path / "copies").iterdir())
    manifest = verify_snapshot(directory)
    assert manifest["schema_revisions"] == ["0008_reusable_remissions"]
    assert manifest["external_backup"] == "pending"
    assert (directory / "attachments/synthetic.txt").read_bytes() == (
        source / "synthetic.txt"
    ).read_bytes()
    arguments, options = next(
        (arguments, options)
        for arguments, options in calls
        if isinstance(arguments, list) and arguments[0] == "pg_dump"
    )
    assert arguments[arguments.index("--snapshot") + 1] == "synthetic-exported-snapshot"
    assert "--no-owner" not in arguments and "--no-acl" not in arguments
    assert "synthetic-test-only" not in " ".join(arguments)
    assert options["env"]["PGPASSWORD"] == "synthetic-test-only"

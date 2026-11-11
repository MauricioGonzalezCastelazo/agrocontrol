import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import OperationalError

from app.local.models import DocumentAction
from app.local.runtime import LocalRuntime
from tests.test_edit_delete import update_payload
from tests.test_sqlite_local import (
    ORIGIN,
    TOKEN,
    authorize,
    carrot_payload,
    customer,
    open_client,
)  # noqa: F401
from tests.test_sqlite_local import local as local


def test_audit_versions_exact_changes_and_durable_edit_replay(local):
    runtime, client = local
    person = customer(client)
    path = f"/api/v1/customers/{person['id']}"
    key = str(uuid4())
    change = {
        "name": "Primera corrección",
        "active": True,
        "notes": "Nota original",
        "expected_version": 1,
    }
    response = client.patch(path, json=change, headers={"Idempotency-Key": key})
    assert response.status_code == 200, response.text
    assert response.headers["X-Operation-Outcome"] == "confirmed"
    second = client.patch(path, json=change | {"name": "Segunda corrección", "expected_version": 2})
    assert second.status_code == 200
    repeated = client.patch(path, json=change, headers={"Idempotency-Key": key})
    assert repeated.status_code == 200 and repeated.json()["name"] == "Segunda corrección"
    assert repeated.json()["version"] == 3 and repeated.headers["X-Operation-Replayed"] == "true"
    receipt = client.get(f"/api/v1/operations/{key}").json()
    assert receipt["response_at_confirmation"]["version"] == 2
    events = client.get(f"/api/v1/audit-events?operation_id={key}").json()["items"]
    assert len(events) == 1
    audit = events[0]
    assert audit["schema_version"] == 2 and audit["occurred_at_utc"].endswith("Z")
    assert audit["operation_id"] == key and audit["author_id"] == str(runtime.principal.user_id)
    assert audit["values_before"]["customers"][person["id"]]["name"] == person["name"]
    assert audit["values_after"]["customers"][person["id"]]["name"] == "Primera corrección"
    assert (
        client.patch(
            path, json=change | {"name": "Other"}, headers={"Idempotency-Key": key}
        ).status_code
        == 409
    )
    with runtime.engine.begin() as connection:
        from sqlalchemy.exc import IntegrityError

        with pytest.raises(IntegrityError):
            connection.execute(text("UPDATE operation_receipts SET outcome='rejected'"))


def test_deletion_reason_is_required_and_logical_history_is_preserved(local):
    runtime, client = local
    person = customer(client)
    data = carrot_payload(person["id"])
    order = client.post("/api/v1/orders", json=data).json()
    path = f"/api/v1/orders/{order['id']}?expected_version=1"
    for body in (None, {"reason": "   "}):
        assert client.request("DELETE", path, json=body).status_code == 422
    assert client.get(f"/api/v1/orders/{order['id']}").status_code == 200
    key = str(uuid4())

    def remove(_):
        return client.request(
            "DELETE",
            path,
            json={"reason": "Duplicado capturado por error"},
            headers={"Idempotency-Key": key},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(remove, range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert client.get(f"/api/v1/orders/{order['id']}").status_code == 410
    event_data = client.get(f"/api/v1/audit-events?operation_id={key}").json()["items"]
    assert len(event_data) == 1 and event_data[0]["reason"] == "Duplicado capturado por error"
    assert event_data[0]["values_before"]["orders"][order["id"]]["deleted_at"] is None
    assert event_data[0]["values_after"]["orders"][order["id"]]["deleted_at"] is not None
    with runtime.engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM orders")) == 1
        assert connection.scalar(text("SELECT count(*) FROM order_carrot_details")) == 1


def test_receipt_failure_rolls_back_business_and_audit_atomically(local):
    runtime, client = local
    body = {"id": str(uuid4()), "name": "Synthetic atomic receipt"}
    key = str(uuid4())

    def fail(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO operation_receipts"):
            raise OperationalError("Synthetic failure writing receipt", {}, None)

    event.listen(runtime.engine, "before_cursor_execute", fail)
    try:
        response = client.post("/api/v1/customers", json=body, headers={"Idempotency-Key": key})
        assert response.status_code == 503 and response.json()["outcome"] == "uncertain"
    finally:
        event.remove(runtime.engine, "before_cursor_execute", fail)
    with runtime.engine.connect() as connection:
        for table in ("customers", "audit_events", "operation_receipts"):
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0
    assert (
        client.post("/api/v1/customers", json=body, headers={"Idempotency-Key": key}).status_code
        == 201
    )
    assert (
        client.post("/api/v1/customers", json=body, headers={"Idempotency-Key": key}).status_code
        == 201
    )
    with runtime.engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM customers")) == 1


def test_restart_retains_operation_receipt_and_does_not_reexecute_edit(tmp_path):
    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    key = str(uuid4())
    with open_client(runtime) as client:
        authorize(client)
        person = customer(client)
        order = client.post("/api/v1/orders", json=carrot_payload(person["id"])).json()
        change = update_payload(order, description="Edición duradera sintética")
        path = f"/api/v1/orders/{order['id']}"
        edited = client.patch(path, json=change, headers={"Idempotency-Key": key})
        assert edited.status_code == 200, edited.text
    restarted = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(restarted) as client:
        authorize(client)
        retried = client.patch(path, json=change, headers={"Idempotency-Key": key})
        assert retried.status_code == 200 and retried.headers["X-Operation-Replayed"] == "true"
        assert retried.json()["version"] == edited.json()["version"]
        assert client.get(f"/api/v1/operations/{key}").json()["outcome"] == "confirmed"
        assert len(client.get(f"/api/v1/audit-events?operation_id={key}").json()["items"]) == 1


def test_concurrent_edits_and_voids_have_one_financial_effect(local):
    runtime, client = local
    person = customer(client)
    payload = carrot_payload(person["id"])
    payload["details"] = {"hectares": "1", "unit_price": "1000"}
    order = client.post("/api/v1/orders", json=payload).json()
    path = f"/api/v1/orders/{order['id']}"

    def edit(index):
        return client.patch(path, json=update_payload(order, description=f"Concurrent {index}"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(edit, range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    receipt = {
        "id": str(uuid4()),
        "customer_id": person["id"],
        "amount": "200",
        "payment_date": "2026-10-21",
        "allocations": [{"order_id": order["id"], "amount": "100"}],
    }
    created = client.post("/api/v1/payments", json=receipt)
    assert created.status_code == 201
    key = str(uuid4())

    def void(_):
        return client.post(
            f"/api/v1/payments/{receipt['id']}/void",
            json={"expected_version": 1, "reason": "Transferencia devuelta"},
            headers={"Idempotency-Key": key},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(void, range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert client.get(path).json()["total_paid"] == "0.00000000"
    audits = client.get(f"/api/v1/audit-events?operation_id={key}").json()["items"]
    assert len(audits) == 1 and audits[0]["reason"] == "Transferencia devuelta"
    assert "orders" in audits[0]["values_after"] and "payments" in audits[0]["values_after"]


def test_diagnostics_detect_calculation_and_remission_errors_without_repairing(local):
    runtime, client = local
    person = customer(client)
    assert client.post("/api/v1/orders", json=carrot_payload(person["id"], 101)).status_code == 201
    second = client.post("/api/v1/orders", json=carrot_payload(person["id"], 102)).json()
    healthy = client.get("/api/v1/local/diagnostics")
    assert healthy.status_code == 200 and healthy.json()["ok"], healthy.text
    with runtime.engine.begin() as connection:
        # Corruption is deliberately restricted to this synthetic temporary database.
        connection.execute(text("DROP INDEX uq_orders_org_product_active_remission"))
        connection.execute(
            text("UPDATE orders SET total_amount='1.00000000', remission_number=101 WHERE id=:id"),
            {"id": UUID(second["id"]).hex},
        )
    diagnosed = client.get("/api/v1/local/diagnostics").json()
    codes = {finding["code"] for finding in diagnosed["findings"]}
    assert {"order_total_mismatch", "duplicate_active_remission"} <= codes
    with runtime.engine.connect() as connection:
        assert (
            connection.scalar(
                text("SELECT total_amount FROM orders WHERE id=:id"), {"id": UUID(second["id"]).hex}
            )
            == "1.00000000"
        )
    assert diagnosed["preservation"]["external_backup"] == "pending"
    assert diagnosed["preservation"]["installation_id"]


def test_document_reconciliation_preserves_temporaries_and_confirms_only_verified_files(local):
    runtime, client = local
    person = customer(client)
    content = b"%PDF-1.7 synthetic interrupted durable document"
    manifest = {
        "id": str(uuid4()),
        "filename": "original.pdf",
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    payload = carrot_payload(person["id"]) | {"attachments": [manifest]}
    order = client.post("/api/v1/orders", json=payload).json()
    target = runtime.files / str(runtime.principal.organization_id) / order["id"] / manifest["id"]
    target.parent.mkdir(parents=True)
    target.write_bytes(content)
    abandoned = runtime.files / f"{uuid4()}.{uuid4()}.part"
    abandoned.write_bytes(b"synthetic interrupted bytes")
    os.utime(abandoned, (1, 1))
    recent = runtime.files / f"{uuid4()}.{uuid4()}.part"
    recent.write_bytes(b"recent bytes")
    unknown = runtime.files / "unidentified-original"
    unknown.write_bytes(b"opaque unreferenced bytes")
    before = client.get("/api/v1/local/diagnostics").json()
    assert {item["code"] for item in before["findings"]} >= {
        "awaiting_confirmation",
        "abandoned_temporary",
        "unreferenced",
    }
    key = str(uuid4())
    body = {"reason": "Revisión sintética después de interrupción", "preserve_temporaries": True}
    reconciled = client.post(
        "/api/v1/local/documents/reconcile", json=body, headers={"Idempotency-Key": key}
    )
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["confirmed_documents"] == 1
    assert reconciled.json()["preserved_temporaries"] == 1
    assert (
        client.post(
            "/api/v1/local/documents/reconcile", json=body, headers={"Idempotency-Key": key}
        ).json()
        == reconciled.json()
    )
    assert abandoned.read_bytes() == b"synthetic interrupted bytes"
    assert (
        recent.read_bytes() == b"recent bytes"
        and unknown.read_bytes() == b"opaque unreferenced bytes"
    )
    assert client.get(f"/api/v1/orders/{order['id']}").json()["attachment_status"] == "complete"
    with runtime.engine.connect() as connection:
        row = connection.execute(select(DocumentAction.__table__)).mappings().one()
        assert (runtime.files / row["destination_path"]).read_bytes() == abandoned.read_bytes()
        assert row["operation_id"] == key
    assert client.get(f"/api/v1/audit-events?operation_id={key}").json()["items"]


def test_diagnostics_report_missing_and_corrupt_files_without_marking_them_ready(local):
    runtime, client = local
    content = b"%PDF-1.7 synthetic original"
    manifest = {
        "id": str(uuid4()),
        "filename": "original.pdf",
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    client.post("/api/v1/local/blobs", json=manifest).raise_for_status()
    client.put(f"/api/v1/local/blobs/{manifest['id']}", content=content).raise_for_status()
    path = runtime.files / "staged" / manifest["id"]
    path.write_bytes(b"x" * len(content))
    assert "corrupt" in {
        item["code"] for item in client.get("/api/v1/local/diagnostics").json()["findings"]
    }
    path.unlink()  # Synthetic test-only loss simulation.
    assert "missing" in {
        item["code"] for item in client.get("/api/v1/local/diagnostics").json()["findings"]
    }
    response = client.post(
        "/api/v1/local/documents/reconcile", json={"reason": "Check missing originals"}
    )
    assert response.status_code == 200 and response.json()["confirmed_documents"] == 0
    assert client.get(f"/api/v1/local/blobs/{manifest['id']}").status_code == 503


@pytest.mark.parametrize("point", ["before", "after"])
def test_process_crash_keeps_edit_audit_and_receipt_atomic(tmp_path, point):
    import subprocess
    import sys

    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(runtime) as client:
        authorize(client)
        person = customer(client)
        order = client.post("/api/v1/orders", json=carrot_payload(person["id"])).json()
    operation = str(uuid4())
    environment = os.environ.copy()
    environment["AGROCONTROL_CRASH_TEST"] = "1"
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "tests.sqlite_crash_worker",
            str(tmp_path),
            operation,
            f"operation-{point}",
        ],
        env=environment,
        capture_output=True,
        timeout=120,
        check=False,
    )
    assert process.returncode == (17 if point == "before" else 18), process.stderr.decode(
        errors="replace"
    )
    restarted = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(restarted) as client:
        authorize(client)
        path = f"/api/v1/orders/{order['id']}"
        current = client.get(path).json()
        assert current["version"] == (1 if point == "before" else 2)
        receipt = client.get(f"/api/v1/operations/{operation}")
        assert receipt.status_code == (404 if point == "before" else 200)
        audits = client.get(f"/api/v1/audit-events?operation_id={operation}").json()["items"]
        assert len(audits) == (0 if point == "before" else 1)
        payload = update_payload(order, description="Synthetic process-interrupted edit")
        for _ in range(2):
            response = client.patch(path, json=payload, headers={"Idempotency-Key": operation})
            assert response.status_code == 200, response.text
            assert response.json()["version"] == 2
        assert (
            len(client.get(f"/api/v1/audit-events?operation_id={operation}").json()["items"]) == 1
        )
        with restarted.engine.connect() as connection:
            assert connection.scalar(text("PRAGMA integrity_check")) == "ok"


def test_failed_temporary_copy_never_loses_original_or_commits_audit(local, monkeypatch):
    from app.local import reconciliation

    runtime, client = local
    abandoned = runtime.files / f"{uuid4()}.{uuid4()}.part"
    abandoned.write_bytes(b"synthetic preserved original")
    os.utime(abandoned, (1, 1))
    original = reconciliation.copy_exclusive

    def fail(source, target):
        original(source, target)
        raise OSError("Synthetic interruption after copying bytes")

    key = str(uuid4())
    body = {"reason": "Synthetic preservation failure"}
    with monkeypatch.context() as patch:
        patch.setattr(reconciliation, "copy_exclusive", fail)
        assert (
            client.post(
                "/api/v1/local/documents/reconcile", json=body, headers={"Idempotency-Key": key}
            ).status_code
            == 503
        )
    assert abandoned.read_bytes() == b"synthetic preserved original"
    assert client.get(f"/api/v1/operations/{key}").status_code == 404
    assert not client.get(f"/api/v1/audit-events?operation_id={key}").json()["items"]
    assert "unreferenced" in {
        item["code"] for item in client.get("/api/v1/local/diagnostics").json()["findings"]
    }
    retried = client.post(
        "/api/v1/local/documents/reconcile", json=body, headers={"Idempotency-Key": key}
    )
    assert retried.status_code == 200 and retried.json()["preserved_temporaries"] == 1
    assert abandoned.read_bytes() == b"synthetic preserved original"


def test_capture_retry_is_idempotent_but_different_stale_capture_is_rejected(local):
    runtime, client = local
    person = customer(client)
    original = client.get("/api/v1/local/store").json()
    first = client.put("/api/v1/local/store", json=original)
    assert first.status_code == 200
    repeated = client.put("/api/v1/local/store", json=original)
    assert repeated.status_code == 200 and repeated.headers["X-Operation-Replayed"] == "true"
    scope = f"{runtime.principal.organization_id}:{runtime.principal.user_id}"
    identifier = str(uuid4())
    row = {
        "key": f"{scope}:{identifier}",
        "scope": scope,
        "kind": "receipt",
        "customerName": person["name"],
        "attempted": False,
        "createdAt": "2026-10-21T00:00:00Z",
        "payload": {
            "id": identifier,
            "customer_id": person["id"],
            "amount": "1.00000001",
            "payment_date": "2026-10-21",
            "allocations": [],
        },
    }
    stale = {"revision": original["revision"], "data": original["data"] | {"payments": [row]}}
    assert client.put("/api/v1/local/store", json=stale).status_code == 409
    current = client.get("/api/v1/local/store").json()
    assert current["revision"] == first.json()["revision"]
    assert current["data"]["payments"] == []
    fresh = stale | {"revision": current["revision"]}
    assert client.put("/api/v1/local/store", json=fresh).status_code == 200
    assert client.get("/api/v1/local/store").json()["data"]["payments"] == [row]

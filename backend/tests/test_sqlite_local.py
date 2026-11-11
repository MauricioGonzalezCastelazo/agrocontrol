import hashlib
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app.local.application import local_application
from app.local.runtime import LocalRuntime

ORIGIN = "http://127.0.0.1:5174"
TOKEN = "synthetic-bootstrap-only-for-local-tests-123456"


def open_client(runtime):
    return TestClient(
        local_application(runtime),
        base_url="http://127.0.0.1:8000",
        client=("127.0.0.1", 55000),
        headers={"Origin": ORIGIN},
    )


def authorize(client):
    response = client.post("/api/v1/local/bootstrap", json={"token": TOKEN})
    assert response.status_code == 200, response.text
    session = response.json()
    client.headers.update(
        {
            "X-Local-CSRF": session["csrf"],
            "X-Organization-ID": session["principal"]["organization_id"],
        }
    )
    return session


@pytest.fixture
def local(tmp_path):
    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(runtime) as client:
        authorize(client)
        yield runtime, client


def customer(client):
    response = client.post(
        "/api/v1/customers",
        json={"id": str(uuid4()), "name": "Cliente SQLite", "active": True, "notes": None},
    )
    assert response.status_code == 201, response.text
    return response.json()


def carrot_payload(customer_id, remission=82):
    return {
        "id": str(uuid4()),
        "customer_id": customer_id,
        "product_type": "carrot",
        "remission_number": remission,
        "order_date": "2026-10-21",
        "description": "Captura sintética",
        "attachments": [],
        "details": {"hectares": "1.2345", "unit_price": "99999999999999.9999"},
    }


def test_local_migrations_exact_values_and_restart(tmp_path):
    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(runtime) as client:
        session = authorize(client)
        data = carrot_payload(customer(client)["id"])
        created = client.post("/api/v1/orders", json=data)
        assert created.status_code == 201, created.text
        assert created.json()["unit_price"] == "99999999999999.9999"
        total = created.json()["total_amount"]
        assert client.post("/api/v1/orders", json=data).json()["id"] == data["id"]
        with runtime.engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1
            assert connection.scalar(text("PRAGMA synchronous")) == 3
            assert connection.scalar(text("PRAGMA journal_mode")) == "delete"
            assert (
                connection.scalar(text("SELECT unit_price FROM order_carrot_details"))
                == 999999999999999999
            )
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version")) == "local_0004"
            )
    restarted = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(restarted) as client:
        renewed = authorize(client)
        assert renewed["principal"] == session["principal"]
        saved = client.get(f"/api/v1/orders/{data['id']}").json()
        assert saved["total_amount"] == total and saved["unit_price"] == "99999999999999.9999"
        assert len(inspect(restarted.engine).get_table_names()) == 19


def test_local_authorization_requires_origin_cookie_and_csrf(local):
    runtime, client = local
    assert client.get("/api/v1/customers", headers={"X-Local-CSRF": "wrong"}).status_code == 403
    assert (
        client.get("/api/v1/customers", headers={"Origin": "https://hostile.example"}).status_code
        == 403
    )
    assert client.get("/api/v1/customers", headers={"Host": "hostile.example"}).status_code == 403
    assert client.post("/api/v1/local/bootstrap", json={"token": TOKEN}).status_code == 401
    with open_client_without_lifespan(runtime) as outsider:
        assert outsider.get("/api/v1/customers").status_code == 401


def open_client_without_lifespan(runtime):
    # A separate HTTP client; no cookies from the authorized browser.
    return TestClient(
        local_application(runtime),
        base_url="http://127.0.0.1:8000",
        client=("127.0.0.1", 55001),
        headers={"Origin": ORIGIN},
    )


def test_sqlite_concurrent_remissions_and_payments(local):
    runtime, client = local
    person = customer(client)
    payload = carrot_payload(person["id"])
    payload["details"] = {"hectares": "1", "unit_price": "1000"}

    def create(candidate):
        return client.post("/api/v1/orders", json=candidate)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, [payload, payload | {"id": str(uuid4())}]))
    assert sorted(result.status_code for result in results) == [201, 409]
    order = next(result.json() for result in results if result.status_code == 201)
    receipt = {
        "id": str(uuid4()),
        "customer_id": person["id"],
        "amount": "2000",
        "payment_date": "2026-10-21",
        "description": "Anticipo",
        "allocations": [],
    }
    payment = client.post("/api/v1/payments", json=receipt)
    assert payment.status_code == 201, payment.text

    def apply(_):
        return client.post(
            f"/api/v1/payments/{receipt['id']}/applications",
            json={
                "id": str(uuid4()),
                "application_date": "2026-10-21",
                "allocations": [{"order_id": order["id"], "amount": "750"}],
            },
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, range(2)))
    assert sorted(result.status_code for result in results) == [201, 409]
    account = client.get(f"/api/v1/payments/{receipt['id']}").json()
    assert account["applied_amount"] == "750.00000000"
    assert account["available_credit"] == "1250.00000000"


def test_failed_attachment_and_store_conflict_are_recoverable(local, monkeypatch):
    runtime, client = local
    content = b"%PDF-1.7\nsynthetic durable attachment"
    manifest = {
        "id": str(uuid4()),
        "filename": "pedido.pdf",
        "sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
    }
    assert client.post("/api/v1/local/blobs", json=manifest).status_code == 200
    path = f"/api/v1/local/blobs/{manifest['id']}"
    assert client.put(path, content=b"incomplete").status_code == 422
    assert client.get(path).status_code == 503
    assert client.put(path, content=content).status_code == 200
    assert client.put(path, content=content).status_code == 200
    assert client.get(path).content == content
    store = client.get("/api/v1/local/store").json()
    assert client.put("/api/v1/local/store", json=store).status_code == 200
    assert client.put("/api/v1/local/store", json=store).status_code == 200
    assert not list(runtime.files.rglob("*.part"))


@pytest.mark.parametrize("mode", ["before", "after"])
def test_abrupt_process_exit_before_and_after_commit(tmp_path, mode):
    identifier = str(uuid4())
    environment = os.environ.copy()
    environment["AGROCONTROL_CRASH_TEST"] = "1"
    crashed = subprocess.run(
        [sys.executable, "-m", "tests.sqlite_crash_worker", str(tmp_path), identifier, mode],
        env=environment,
        capture_output=True,
        timeout=120,
    )
    assert crashed.returncode == (17 if mode == "before" else 18), crashed.stderr.decode(
        errors="replace"
    )
    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(runtime) as client:
        authorize(client)
        result = client.get(f"/api/v1/customers/{identifier}")
        assert result.status_code == (404 if mode == "before" else 200)
        if mode == "after":
            retried = client.post(
                "/api/v1/customers", json={"id": identifier, "name": "Committed synthetic capture"}
            )
            assert retried.status_code == 201 and retried.json()["id"] == identifier
        with runtime.engine.connect() as connection:
            assert connection.scalar(text("PRAGMA integrity_check")) == "ok"
            assert connection.scalar(
                text("SELECT count(*) FROM audit_events WHERE action='customer.created'")
            ) == (0 if mode == "before" else 1)


@pytest.mark.parametrize("mode", ["before", "after"])
def test_payment_process_crash_preserves_atomic_balances_and_retry(tmp_path, mode):
    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(runtime) as client:
        authorize(client)
        person = customer(client)
        payload = carrot_payload(person["id"])
        payload["details"] = {"hectares": "1", "unit_price": "1000"}
        order = client.post("/api/v1/orders", json=payload).json()
    identifier = str(uuid4())
    environment = os.environ.copy()
    environment["AGROCONTROL_CRASH_TEST"] = "1"
    crashed = subprocess.run(
        [
            sys.executable,
            "-m",
            "tests.sqlite_crash_worker",
            str(tmp_path),
            identifier,
            f"payment-{mode}",
        ],
        env=environment,
        capture_output=True,
        timeout=120,
    )
    assert crashed.returncode == (17 if mode == "before" else 18), crashed.stderr.decode(
        errors="replace"
    )
    restarted = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(restarted) as client:
        authorize(client)
        with restarted.engine.connect() as connection:
            assert connection.scalar(text("PRAGMA integrity_check")) == "ok"
            assert not connection.execute(text("PRAGMA foreign_key_check")).all()
            for table in ("payments", "payment_applications", "payment_allocations"):
                assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == (
                    0 if mode == "before" else 1
                )
        saved = client.get(f"/api/v1/orders/{order['id']}").json()
        assert saved["total_paid"] == ("0.00000000" if mode == "before" else "300.12345678")
        receipt = {
            "id": identifier,
            "customer_id": person["id"],
            "amount": "500.12345678",
            "payment_date": "2026-10-21",
            "allocations": [{"order_id": order["id"], "amount": "300.12345678"}],
        }
        for _ in range(2):
            retried = client.post("/api/v1/payments", json=receipt)
            assert retried.status_code == 201, retried.text
            assert retried.json()["available_credit"] == "200.00000000"
        saved = client.get(f"/api/v1/orders/{order['id']}").json()
        assert saved["total_paid"] == "300.12345678"
        assert saved["remaining_amount"] == "699.87654322"
        with restarted.engine.connect() as connection:
            assert connection.scalar(text("SELECT count(*) FROM payments")) == 1
            assert (
                connection.scalar(
                    text("SELECT count(*) FROM audit_events WHERE action='payment.created'")
                )
                == 1
            )


def test_attachment_rename_before_metadata_commit_recovers_after_restart(tmp_path, monkeypatch):
    from app.local import routes

    content = b"%PDF-1.7 synthetic interrupted confirmation"
    manifest = {
        "id": str(uuid4()),
        "filename": "interrupted.pdf",
        "sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
    }
    runtime = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    original = routes.durable_replace

    def interruption(temporary, destination):
        original(temporary, destination)
        raise OSError("Synthetic failure after durable rename")

    with open_client(runtime) as client:
        authorize(client)
        client.post("/api/v1/local/blobs", json=manifest).raise_for_status()
        with monkeypatch.context() as patch:
            patch.setattr(routes, "durable_replace", interruption)
            assert (
                client.put(f"/api/v1/local/blobs/{manifest['id']}", content=content).status_code
                == 503
            )
    restarted = LocalRuntime(tmp_path, ORIGIN, TOKEN)
    with open_client(restarted) as client:
        authorize(client)
        path = f"/api/v1/local/blobs/{manifest['id']}"
        assert client.get(path).status_code == 503
        assert client.put(path, content=content).status_code == 200
        assert client.get(path).content == content
        assert len(list((restarted.files / "staged").iterdir())) == 1


def test_sqlite_referential_constraints_failed_transaction_and_history(local):
    from sqlalchemy.exc import IntegrityError

    runtime, client = local
    person = customer(client)
    data = carrot_payload(person["id"])
    with runtime.engine.begin() as connection:
        with pytest.raises(IntegrityError):
            connection.execute(
                text(
                    "INSERT INTO customers (id, organization_id, name, active, version) "
                    "VALUES (:id, :org, 'Invalid reference', 1, 1)"
                ),
                {"id": uuid4().hex, "org": uuid4().hex},
            )
    created = client.post("/api/v1/orders", json=data)
    assert created.status_code == 201
    order = created.json()
    for statement in [
        "UPDATE order_carrot_details SET unit_price=0.25",
        "UPDATE orders SET total_amount='not money'",
        "DELETE FROM orders",
        "DELETE FROM audit_events",
    ]:
        with pytest.raises(IntegrityError), runtime.engine.begin() as connection:
            connection.execute(text(statement))
    assert client.get(f"/api/v1/orders/{order['id']}").json()["unit_price"] == order["unit_price"]
    assert (
        client.request(
            "DELETE",
            f"/api/v1/orders/{order['id']}?expected_version=1",
            json={"reason": "Correccion sintetica autorizada"},
        ).status_code
        == 200
    )
    assert client.post("/api/v1/orders", json=data | {"id": str(uuid4())}).status_code == 201


def test_duplicate_payment_requests_commit_once(local):
    runtime, client = local
    receipt = {
        "id": str(uuid4()),
        "customer_id": customer(client)["id"],
        "amount": "999999999999999999999999.12345678",
        "payment_date": "2026-10-21",
        "allocations": [],
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post("/api/v1/payments", json=receipt), range(2)))
    assert [result.status_code for result in results] == [201, 201]
    with runtime.engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM payments")) == 1
        assert connection.scalar(text("SELECT amount FROM payments")) == receipt["amount"]
        assert (
            connection.scalar(
                text("SELECT count(*) FROM audit_events WHERE action='payment.created'")
            )
            == 1
        )


def test_failed_payment_transaction_rolls_back_all_related_records(local):
    from sqlalchemy import event
    from sqlalchemy.exc import OperationalError

    runtime, client = local
    person = customer(client)
    payload = carrot_payload(person["id"])
    payload["details"] = {"hectares": "1", "unit_price": "1000"}
    order = client.post("/api/v1/orders", json=payload).json()
    receipt = {
        "id": str(uuid4()),
        "customer_id": person["id"],
        "amount": "500",
        "payment_date": "2026-10-21",
        "allocations": [{"order_id": order["id"], "amount": "300"}],
    }

    def fail_allocation(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO payment_allocations"):
            raise OperationalError("synthetic write interruption", {}, None)

    event.listen(runtime.engine, "before_cursor_execute", fail_allocation)
    try:
        assert client.post("/api/v1/payments", json=receipt).status_code == 503
    finally:
        event.remove(runtime.engine, "before_cursor_execute", fail_allocation)
    with runtime.engine.connect() as connection:
        for table in ("payments", "payment_applications", "payment_allocations"):
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0
    assert client.post("/api/v1/payments", json=receipt).status_code == 201
    assert client.get(f"/api/v1/orders/{order['id']}").json()["total_paid"] == "300.00000000"


def test_local_session_rejects_missing_origin_csrf_and_expired_session(local):
    runtime, client = local
    headers = dict(client.headers)
    del client.headers["Origin"]
    assert client.get("/api/v1/customers").status_code == 403
    client.headers.update(headers)
    del client.headers["X-Local-CSRF"]
    assert client.get("/api/v1/customers").status_code == 403
    client.headers.update(headers)
    with runtime.lock:
        for key, (csrf, _) in runtime.sessions.items():
            runtime.sessions[key] = (csrf, 0)
    assert client.get("/api/v1/customers").status_code == 401


def test_local_paths_support_windows_macos_and_explicit_absolute_root(tmp_path, monkeypatch):
    from app.local import paths

    monkeypatch.delenv("AGROCONTROL_DATA_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "AppData"))
    monkeypatch.setattr(paths.sys, "platform", "win32")
    assert paths.data_directory() == tmp_path / "AppData" / "AgroControl"
    monkeypatch.setattr(paths.sys, "platform", "darwin")
    monkeypatch.setattr(paths.Path, "home", lambda: tmp_path)
    assert paths.data_directory() == tmp_path / "Library" / "Application Support" / "AgroControl"
    monkeypatch.setenv("AGROCONTROL_DATA_DIR", str(tmp_path / "dedicated"))
    assert paths.data_directory() == tmp_path / "dedicated"
    monkeypatch.setenv("AGROCONTROL_DATA_DIR", "relative-path")
    with pytest.raises(ValueError, match="absolute"):
        paths.data_directory()


def test_local_file_type_checks_and_corruption_preserve_metadata(local):
    runtime, client = local
    content = b"executable renamed as a PDF"
    manifest = {
        "id": str(uuid4()),
        "filename": "invalid.pdf",
        "sha256": hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
    }
    assert client.post("/api/v1/local/blobs", json=manifest).status_code == 200
    assert client.put(f"/api/v1/local/blobs/{manifest['id']}", content=content).status_code == 422
    assert not (runtime.files / "staged" / manifest["id"]).exists()
    assert (
        client.post(
            "/api/v1/local/blobs", json=manifest | {"filename": "../invalid.pdf"}
        ).status_code
        == 422
    )
    valid = b"%PDF-1.7 synthetic original"
    manifest = manifest | {
        "id": str(uuid4()),
        "sha256": hashlib.sha256(valid).hexdigest(),
        "size_bytes": len(valid),
    }
    client.post("/api/v1/local/blobs", json=manifest).raise_for_status()
    client.put(f"/api/v1/local/blobs/{manifest['id']}", content=valid).raise_for_status()
    (runtime.files / "staged" / manifest["id"]).write_bytes(b"x" * len(valid))
    assert client.get(f"/api/v1/local/blobs/{manifest['id']}").status_code == 503
    assert client.put(f"/api/v1/local/blobs/{manifest['id']}", content=valid).status_code == 200
    assert client.get(f"/api/v1/local/blobs/{manifest['id']}").content == valid


def test_historical_private_hashes_remain_idempotent_without_decimal_collisions(local):
    from uuid import UUID

    from sqlalchemy.orm import Session

    from app.modules.operations import fingerprint
    from app.modules.payment_schemas import PaymentInput
    from app.persistence.models import Payment

    runtime, client = local
    receipt = {
        "id": str(uuid4()),
        "customer_id": customer(client)["id"],
        "amount": "999999999999999999999999.12345678",
        "payment_date": "2026-10-21",
        "allocations": [],
    }
    assert client.post("/api/v1/payments", json=receipt).status_code == 201
    original = PaymentInput.model_validate(receipt)
    changed = PaymentInput.model_validate(receipt | {"amount": "999999999999999999999999.12345679"})
    assert fingerprint(original, precision=28) == fingerprint(changed, precision=28)
    assert fingerprint(original) != fingerprint(changed)
    with Session(runtime.engine) as db:
        db.get(Payment, UUID(receipt["id"])).creation_hash = fingerprint(original, precision=28)
        db.commit()
    assert client.post("/api/v1/payments", json=receipt).status_code == 201
    assert (
        client.post(
            "/api/v1/payments", json=receipt | {"amount": "999999999999999999999999.12345679"}
        ).status_code
        == 409
    )

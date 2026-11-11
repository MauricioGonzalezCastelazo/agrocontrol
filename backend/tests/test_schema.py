import os
from decimal import Decimal
from io import StringIO
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.persistence.base import Base
from app.persistence.models import (
    Customer,
    Membership,
    Order,
    Organization,
)
from tests.conftest import ORG, OTHER_ORG, USER


def test_order_cannot_reference_customer_from_another_organization(db):
    customer_id = uuid4()
    db.add(Customer(id=customer_id, organization_id=OTHER_ORG, name="Cliente sintético"))
    db.commit()
    db.add(
        Order(
            organization_id=ORG,
            customer_id=customer_id,
            product_type="carrot",
            total_amount=Decimal("1"),
            created_by=USER,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_schema_blocks_unsupported_products(db):
    customer_id = uuid4()
    db.add(Customer(id=customer_id, organization_id=ORG, name="Cliente sintético"))
    db.commit()
    db.add(
        Order(
            organization_id=ORG,
            customer_id=customer_id,
            product_type="unknown",
            total_amount=Decimal("0"),
            created_by=USER,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_postgresql_migration_sql_is_generated(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test@localhost/agrocontrol_test")
    get_settings.cache_clear()
    try:
        output = StringIO()
        command.upgrade(Config("alembic.ini", output_buffer=output), "head", sql=True)
        sql = output.getvalue()
        assert "NUMERIC(32, 8)" in sql
        assert "CREATE TABLE orders" in sql
        assert "FOREIGN KEY(customer_id, organization_id)" in sql
        assert "CREATE UNIQUE INDEX uq_orders_org_product_active_remission" in sql
        assert "WHERE deleted_at IS NULL" in sql
    finally:
        get_settings.cache_clear()


def exercise_postgresql_remission_migration(engine, client, headers, config, db):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi import HTTPException
    from sqlalchemy import select

    from app.api.dependencies import Principal
    from app.modules.operations import create_order
    from app.modules.schemas import OrderCreate
    from tests.test_operations import make_customer, order_payload

    customer, _ = make_customer(client, headers)
    other, _ = make_customer(client, headers)
    payload = order_payload(customer["id"], remission_number=2147483600)
    original = client.post("/api/v1/orders", headers=headers, json=payload)
    assert original.status_code == 201, original.text
    assert (
        client.request(
            "DELETE",
            f"/api/v1/orders/{payload['id']}?expected_version=1",
            headers=headers,
            json={"reason": "Correccion sintetica autorizada"},
        ).status_code
        == 200
    )
    db.commit()
    command.downgrade(config, "0007_remissions_payments")
    duplicate = payload | {"id": str(uuid4())}
    assert client.post("/api/v1/orders", headers=headers, json=duplicate).status_code == 409
    db.commit()
    command.upgrade(config, "head")
    db.expire_all()
    previous = db.get(Order, UUID(payload["id"]))
    assert previous.deleted_at is not None and previous.remission_number == 2147483600
    db.commit()

    # Different customers avoid serializing on one customer's lock. The partial unique
    # index must allow only one concurrent replacement of the deleted remission.
    barrier = Barrier(2)

    def worker(customer_id):
        with Session(engine) as session:
            candidate = OrderCreate.model_validate(
                duplicate | {"id": str(uuid4()), "customer_id": customer_id}
            )
            barrier.wait(timeout=10)
            try:
                create_order(session, Principal(USER, ORG, "operator"), candidate)
                return 201
            except HTTPException as error:
                session.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(worker, [customer["id"], other["id"]]))
    assert sorted(statuses) == [201, 409]
    current = db.scalar(
        select(Order).where(
            Order.organization_id == ORG,
            Order.product_type == "carrot",
            Order.remission_number == 2147483600,
            Order.deleted_at.is_(None),
        )
    )
    assert current is not None
    assert (
        client.request(
            "DELETE",
            f"/api/v1/orders/{current.id}?expected_version=1",
            headers=headers,
            json={"reason": "Correccion sintetica autorizada"},
        ).status_code
        == 200
    )
    replacement = client.post("/api/v1/orders", headers=headers, json=duplicate)
    assert replacement.status_code == 201, replacement.text
    assert client.get(f"/api/v1/orders/{payload['id']}", headers=headers).status_code == 410
    assert client.post("/api/v1/orders", headers=headers, json=payload).status_code == 410
    db.commit()
    with pytest.raises(RuntimeError, match="remisiones reutilizadas"):
        command.downgrade(config, "0007_remissions_payments")
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []


@pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="Requiere PostgreSQL dedicado de pruebas"
)
def test_postgresql_migrations_constraints_audit_and_concurrency(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from sqlalchemy import text

    from app.api.dependencies import get_identity_provider
    from app.core.config import get_settings
    from app.main import create_app
    from app.persistence.database import get_db
    from tests.conftest import TestIdentityProvider
    from tests.test_edit_delete import update_payload
    from tests.test_operations import exercise_private_attachment, make_customer, order_payload
    from tests.test_payments import exercise_postgresql_payment_concurrency

    url = os.environ["TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert parsed.get_backend_name() == "postgresql" and parsed.database.endswith("_test")
    engine = create_engine(url)
    assert not inspect(engine).get_table_names(), "Dedicated test database must initially be empty"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    monkeypatch.setattr(get_settings(), "private_files_path", tmp_path / "attachments")
    config = Config("alembic.ini")
    try:
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        with Session(engine) as session:
            session.add_all(
                [
                    Organization(id=ORG, name="Synthetic A"),
                    Organization(id=OTHER_ORG, name="Synthetic B"),
                ]
            )
            session.flush()
            session.add(Membership(organization_id=ORG, user_id=USER, role="administrator"))
            session.commit()
            test_order_cannot_reference_customer_from_another_organization(session)
            test_schema_blocks_unsupported_products(session)
        application = create_app()

        def database():
            with Session(engine) as session:
                yield session

        application.dependency_overrides[get_db] = database
        application.dependency_overrides[get_identity_provider] = TestIdentityProvider
        headers = {"Authorization": "Bearer test-identity-token", "X-Organization-ID": str(ORG)}
        with TestClient(application) as client:
            customer, _ = make_customer(client, headers)
            payload = order_payload(
                customer["id"],
                details={"hectares": "9999999999.9999", "unit_price": "99999999999999.9999"},
            )
            created = client.post("/api/v1/orders", headers=headers, json=payload)
            assert created.status_code == 201, created.text
            assert created.json()["total_amount"] == "999999999999989999000000.00000001"
            operation = str(uuid4())
            edit = update_payload(created.json())
            key_headers = headers | {"Idempotency-Key": operation}
            assert (
                client.patch(
                    f"/api/v1/orders/{payload['id']}", headers=key_headers, json=edit
                ).status_code
                == 200
            )
            assert (
                client.patch(
                    f"/api/v1/orders/{payload['id']}", headers=key_headers, json=edit
                ).headers["X-Operation-Replayed"]
                == "true"
            )
            audit = client.get(
                f"/api/v1/audit-events?operation_id={operation}", headers=headers
            ).json()["items"]
            assert len(audit) == 1 and audit[0]["schema_version"] == 2
            assert audit[0]["occurred_at_utc"].endswith("Z")
            exercise_private_attachment(client, headers)
            exercise_postgresql_payment_concurrency(engine, client, headers)
        with engine.begin() as connection:
            with pytest.raises(IntegrityError):
                connection.execute(text("UPDATE audit_events SET action='tampered'"))
        with pytest.raises(RuntimeError, match="No automatic downgrade"):
            command.downgrade(config, "0008_reusable_remissions")
    finally:
        # Only this initially empty, synthetic *_test database is cleaned up.
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        get_settings.cache_clear()

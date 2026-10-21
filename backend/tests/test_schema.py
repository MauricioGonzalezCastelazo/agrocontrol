import os
from decimal import Decimal
from io import StringIO
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, delete, inspect, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.persistence.base import Base
from app.persistence.models import (
    Customer,
    Membership,
    Order,
    Organization,
    Payment,
    PaymentAllocation,
    PaymentApplication,
    PotatoDetails,
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
        client.delete(
            f"/api/v1/orders/{payload['id']}?expected_version=1", headers=headers
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
        client.delete(
            f"/api/v1/orders/{current.id}?expected_version=1", headers=headers
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
def test_postgresql_migration_roundtrip_and_constraints(monkeypatch, tmp_path):
    from app.core.config import get_settings

    url = os.environ["TEST_DATABASE_URL"]
    parsed = make_url(url)
    assert parsed.get_backend_name() == "postgresql" and parsed.database.endswith("_test")
    engine = create_engine(url)
    assert not inspect(engine).get_table_names(), "La base de pruebas debe estar vacía"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config("alembic.ini")
    try:
        command.upgrade(config, "head")
        with engine.connect() as connection:
            assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        with Session(engine) as db:
            db.add_all(
                [
                    Organization(id=ORG, name="Empresa A"),
                    Organization(id=OTHER_ORG, name="Empresa B"),
                ]
            )
            db.flush()
            db.add(Membership(organization_id=ORG, user_id=USER, role="operator"))
            db.commit()
            test_order_cannot_reference_customer_from_another_organization(db)
            test_schema_blocks_unsupported_products(db)
            from fastapi.testclient import TestClient

            from app.api.dependencies import get_identity_provider
            from app.main import create_app
            from app.persistence.database import get_db
            from tests.conftest import TestIdentityProvider
            from tests.test_operations import (
                exercise_private_attachment,
                make_customer,
                order_payload,
            )

            application = create_app()
            application.dependency_overrides[get_db] = lambda: db
            application.dependency_overrides[get_identity_provider] = TestIdentityProvider
            monkeypatch.setattr(get_settings(), "private_files_path", tmp_path)
            headers = {"Authorization": "Bearer test-identity-token", "X-Organization-ID": str(ORG)}
            with TestClient(application) as client:
                customer, _ = make_customer(client, headers)
                payload = order_payload(
                    customer["id"],
                    details={"hectares": "9999999999.9999", "unit_price": "99999999999999.9999"},
                )
                response = client.post("/api/v1/orders", headers=headers, json=payload)
                assert response.status_code == 201, response.text
                assert response.json()["total_amount"] == "999999999999989999000000.00000001"
                assert (
                    client.post("/api/v1/orders", headers=headers, json=payload).json()["id"]
                    == payload["id"]
                )
                from tests.test_edit_delete import update_payload

                changed = client.patch(
                    f"/api/v1/orders/{payload['id']}",
                    headers=headers,
                    json=update_payload(response.json()),
                )
                assert (
                    changed.status_code == 200 and changed.json()["total_amount"] == "500.50000000"
                )
                deleted = client.delete(
                    f"/api/v1/orders/{payload['id']}?expected_version=2", headers=headers
                )
                assert deleted.status_code == 200
                assert (
                    client.get(f"/api/v1/orders/{payload['id']}", headers=headers).status_code
                    == 410
                )
                assert (
                    client.post("/api/v1/orders", headers=headers, json=payload).status_code == 410
                )
                exercise_private_attachment(client, headers)
                from app.domain.potato import calculate_potato
                from tests.test_potato import FIXTURES, potato_input

                potato_payload = order_payload(customer["id"]) | {
                    "product_type": "potato",
                    "details": potato_input(FIXTURES[-1]),
                }
                potato = client.post("/api/v1/orders", headers=headers, json=potato_payload)
                assert potato.status_code == 201, potato.text
                assert potato.json()["potato"] == calculate_potato(potato_payload["details"])
                order_id = UUID(potato.json()["id"])
                legacy = calculate_potato(potato_payload["details"], version="potato-v1")
                db.get(PotatoDetails, order_id).calculation_version = "potato-v1"
                db.get(Order, order_id).total_amount = Decimal(legacy["total_amount"])
                db.commit()
                with pytest.raises(RuntimeError, match="cobros o remisiones"):
                    command.downgrade(config, "0006_editable_shrinkage")
                db.execute(update(Order).values(remission_number=None))
                db.commit()
                command.downgrade(config, "0004_potato")
                command.upgrade(config, "head")
                db.expire_all()
                historical = client.get(f"/api/v1/orders/{order_id}", headers=headers)
                assert historical.json()["potato"] == legacy
                assert historical.json()["total_amount"] == legacy["total_amount"]
                potato = client.patch(
                    f"/api/v1/orders/{order_id}",
                    headers=headers,
                    json={key: value for key, value in potato_payload.items() if key != "id"}
                    | {"expected_version": 1},
                )
                assert potato.status_code == 200, potato.text
                assert potato.json()["potato"]["calculation_version"] == "potato-v2"
                update_fields = {key: value for key, value in potato_payload.items() if key != "id"}
                manual = client.patch(
                    f"/api/v1/orders/{order_id}",
                    headers=headers,
                    json=update_fields
                    | {
                        "expected_version": potato.json()["version"],
                        "details": potato_payload["details"] | {"shrinkage_override": "1234.5678"},
                    },
                )
                assert manual.status_code == 200, manual.text
                assert manual.json()["potato"]["shrinkage"] == "1234.56780000"
                assert manual.json()["total_amount"] == potato.json()["total_amount"]
                db.commit()
                db.execute(update(Order).values(remission_number=None))
                db.commit()
                with pytest.raises(RuntimeError, match="MERMA manual"):
                    command.downgrade(config, "0005_potato_formula")
                potato = client.patch(
                    f"/api/v1/orders/{order_id}",
                    headers=headers,
                    json=update_fields
                    | {
                        "expected_version": manual.json()["version"],
                        "details": potato_payload["details"],
                    },
                )
                assert potato.status_code == 200, potato.text
                assert potato.json()["potato"]["shrinkage_override"] is None
                db.commit()
                db.execute(update(Order).values(remission_number=None))
                db.commit()
                with pytest.raises(RuntimeError, match="existen pedidos de papa"):
                    command.downgrade(config, "0003_edit_delete")
                converted = client.patch(
                    f"/api/v1/orders/{potato.json()['id']}",
                    headers=headers,
                    json=update_payload(potato.json())
                    | {
                        "product_type": "carrot",
                        "details": {"hectares": "1.25", "unit_price": "100.50"},
                    },
                )
                assert converted.status_code == 200, converted.text
                assert converted.json()["total_amount"] == "125.62500000"
                from tests.test_payments import (
                    exercise_postgresql_payment_concurrency,
                    test_order_can_be_deleted_after_removing_all_active_payments,
                )

                test_order_can_be_deleted_after_removing_all_active_payments(
                    client, headers, db, "void"
                )
                exercise_postgresql_payment_concurrency(engine, client, headers)
                db.commit()
                with pytest.raises(RuntimeError, match="cobros o remisiones"):
                    command.downgrade(config, "0006_editable_shrinkage")
                # Synthetic records in the verified, initially empty *_test database only.
                exercise_postgresql_remission_migration(engine, client, headers, config, db)
                db.execute(delete(PaymentAllocation))
                db.execute(delete(PaymentApplication))
                db.execute(delete(Payment))
                db.execute(update(Order).values(remission_number=None))
                db.commit()
        command.downgrade(config, "base")
        assert inspect(engine).get_table_names() == ["alembic_version"]
    finally:
        # Cleanup is limited to the empty, dedicated *_test database verified above.
        from sqlalchemy import text

        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
        engine.dispose()
        get_settings.cache_clear()

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.api.dependencies import Principal
from app.modules import payments
from app.modules.operations import create_order
from app.modules.schemas import OrderCreate
from app.persistence.models import Membership, Order, Payment, PaymentAllocation
from tests.conftest import ORG, OTHER_ORG, USER
from tests.test_edit_delete import update_payload
from tests.test_operations import make_customer, order_payload
from tests.test_potato import potato_input


def make_order(client, headers, customer_id, **changes):
    payload = order_payload(
        customer_id, **({"details": {"hectares": "1", "unit_price": "100"}} | changes)
    )
    result = client.post("/api/v1/orders", headers=headers, json=payload)
    assert result.status_code == 201, result.text
    return result.json()


def receipt(customer_id, amount="100", allocations=None):
    return {
        "id": str(uuid4()),
        "customer_id": customer_id,
        "amount": amount,
        "payment_date": "2026-10-20",
        "description": "Transferencia de prueba",
        "allocations": allocations or [],
    }


def post(client, headers, payload, status=201):
    result = client.post("/api/v1/payments", headers=headers, json=payload)
    assert result.status_code == status, result.text
    return result.json()


def read_order(client, headers, order):
    return client.get(f"/api/v1/orders/{order['id']}", headers=headers).json()


def test_remission_unique_per_product_across_customers_and_active_orders(client, headers):
    customer, _ = make_customer(client, headers)
    other, _ = make_customer(client, headers)
    carrot = make_order(client, headers, customer["id"], remission_number=82)
    assert (carrot["total_paid"], carrot["remaining_amount"], carrot["payment_status"]) == (
        "0.00000000",
        "100.00000000",
        "unpaid",
    )
    duplicate = order_payload(other["id"], remission_number=82)
    assert client.post("/api/v1/orders", headers=headers, json=duplicate).status_code == 409
    potato = order_payload(
        customer["id"], remission_number=82, product_type="potato", details=potato_input()
    )
    assert client.post("/api/v1/orders", headers=headers, json=potato).status_code == 201
    found = client.get("/api/v1/orders?q=82", headers=headers).json()
    assert found["total"] == 2
    another = make_order(client, headers, other["id"], remission_number=83)
    conflict = client.patch(
        f"/api/v1/orders/{another['id']}",
        headers=headers,
        json=update_payload(another, remission_number=82),
    )
    assert conflict.status_code == 409, conflict.text
    assert (
        client.delete(
            f"/api/v1/orders/{carrot['id']}?expected_version=1", headers=headers
        ).status_code
        == 200
    )
    reused = client.post("/api/v1/orders", headers=headers, json=duplicate)
    assert reused.status_code == 201, reused.text
    assert reused.json()["id"] != carrot["id"]
    duplicate["id"] = str(uuid4())
    assert client.post("/api/v1/orders", headers=headers, json=duplicate).status_code == 409
    assert client.get(f"/api/v1/orders/{carrot['id']}", headers=headers).status_code == 410


@pytest.mark.parametrize("product_type", ["carrot", "potato"])
def test_deleted_remission_can_be_reused_when_editing(client, headers, db, product_type):
    customer, _ = make_customer(client, headers)
    other, _ = make_customer(client, headers)
    fields = {"product_type": product_type}
    if product_type == "potato":
        fields["details"] = potato_input()
    former = make_order(client, headers, customer["id"], remission_number=1, **fields)
    target = make_order(client, headers, other["id"], remission_number=2, **fields)
    path = f"/api/v1/orders/{target['id']}"
    edit = update_payload(target, remission_number=1, **fields)
    conflict = client.patch(path, headers=headers, json=edit)
    assert conflict.status_code == 409
    assert "pedido vigente" in conflict.json()["detail"]
    deleted_path = f"/api/v1/orders/{former['id']}?expected_version=1"
    assert client.delete(deleted_path, headers=headers).status_code == 200
    changed = client.patch(path, headers=headers, json=edit)
    assert changed.status_code == 200, changed.text
    assert changed.json()["remission_number"] == 1
    assert db.get(Order, UUID(former["id"])).remission_number == 1
    duplicate = order_payload(customer["id"], remission_number=1, **fields)
    assert client.post("/api/v1/orders", headers=headers, json=duplicate).status_code == 409
    # Retrying the old deletion must not release the replacement's reservation.
    assert client.delete(deleted_path, headers=headers).status_code == 200
    assert client.post("/api/v1/orders", headers=headers, json=duplicate).status_code == 409
    make_order(client, headers, customer["id"], remission_number=2, **fields)


@pytest.mark.parametrize("value", [None, 0, -1, 1.5, "82", True, 2147483648])
def test_new_order_requires_positive_integer_remission(client, headers, value):
    customer, _ = make_customer(client, headers)
    assert (
        client.post(
            "/api/v1/orders",
            headers=headers,
            json=order_payload(customer["id"], remission_number=value),
        ).status_code
        == 422
    )


def test_partial_payments_advance_credit_split_and_idempotent_retries(client, headers, db):
    customer, _ = make_customer(client, headers)
    first = make_order(client, headers, customer["id"])
    second = make_order(client, headers, customer["id"])
    initial = receipt(customer["id"], "30", [{"order_id": first["id"], "amount": "30"}])
    partial = post(client, headers, initial)
    assert partial["available_credit"] == "0.00000000"
    assert post(client, headers, initial)["id"] == partial["id"]
    assert read_order(client, headers, first)["remaining_amount"] == "70.00000000"
    advance_payload = receipt(customer["id"], "200")
    advance = post(client, headers, advance_payload)
    assert advance["available_credit"] == "200.00000000"
    apply = {
        "id": str(uuid4()),
        "application_date": "2026-10-21",
        "description": "Aplicar anticipo",
        "allocations": [
            {"order_id": first["id"], "amount": "70"},
            {"order_id": second["id"], "amount": "50"},
        ],
    }
    path = f"/api/v1/payments/{advance['id']}/applications"
    response = client.post(path, headers=headers, json=apply)
    assert response.status_code == 201, response.text
    assert response.json()["available_credit"] == "80.00000000"
    assert client.post(path, headers=headers, json=apply).json()["version"] == 2
    assert read_order(client, headers, first)["payment_status"] == "paid"
    assert read_order(client, headers, second)["total_paid"] == "50.00000000"
    account = client.get(
        f"/api/v1/customer-accounts?customer_id={customer['id']}", headers=headers
    ).json()["items"][0]
    assert account["total_received"] == "230.00000000"
    assert account["total_paid"] == "150.00000000"
    assert account["available_credit"] == "80.00000000"
    assert account["remaining_amount"] == "50.00000000"
    assert db.scalar(select(func.count()).select_from(Payment)) == 2
    assert db.scalar(select(func.count()).select_from(PaymentAllocation)) == 3
    post(client, headers, initial | {"amount": "31"}, status=409)


def test_overpayments_stay_credit_and_invalid_applications_roll_back(client, headers, db):
    customer, _ = make_customer(client, headers)
    other, _ = make_customer(client, headers)
    first = make_order(client, headers, customer["id"])
    wrong = make_order(client, headers, other["id"])
    post(
        client,
        headers,
        receipt(customer["id"], "200", [{"order_id": first["id"], "amount": "100"}]),
    )
    assert read_order(client, headers, first)["total_paid"] == "100.00000000"
    cases = [
        (receipt(customer["id"], "200", [{"order_id": first["id"], "amount": "1"}]), 409),
        (receipt(customer["id"], "200", [{"order_id": wrong["id"], "amount": "10"}]), 422),
        (receipt(customer["id"], "1", [{"order_id": wrong["id"], "amount": "10"}]), 422),
        (receipt(customer["id"], "10", [{"order_id": wrong["id"], "amount": "1"}] * 2), 422),
    ]
    for payload, status in cases:
        post(client, headers, payload, status)
    assert db.scalar(select(func.count()).select_from(Payment)) == 1
    assert read_order(client, headers, wrong)["total_paid"] == "0.00000000"


def test_undo_and_void_preserve_history_and_protect_orders(client, headers, db):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    payment = post(
        client, headers, receipt(customer["id"], "120", [{"order_id": order["id"], "amount": "70"}])
    )
    current = read_order(client, headers, order)
    endpoint = f"/api/v1/orders/{order['id']}"
    for change in [{"details": {"hectares": "1", "unit_price": "69"}}, {"remission_number": 55}]:
        assert (
            client.patch(
                endpoint, headers=headers, json=update_payload(current, **change)
            ).status_code
            == 409
        )
    assert (
        client.delete(
            endpoint + f"?expected_version={current['version']}", headers=headers
        ).status_code
        == 409
    )
    path = f"/api/v1/payments/{payment['id']}"
    undo = {"expected_version": payment["version"], "reason": "Se aplicó al pedido incorrecto"}
    result = client.post(path + f"/applications/{payment['id']}/void", headers=headers, json=undo)
    assert result.status_code == 200, result.text
    assert result.json()["available_credit"] == "120.00000000"
    assert read_order(client, headers, order)["total_paid"] == "0.00000000"
    assert client.delete(endpoint + "?expected_version=3", headers=headers).status_code == 200
    assert client.post(path + "/void", headers=headers, json=undo).status_code == 409
    void = undo | {"expected_version": 2, "reason": "Transferencia revertida"}
    result = client.post(path + "/void", headers=headers, json=void)
    assert result.json()["available_credit"] == "0.00000000"
    assert result.json()["void_reason"] == "Transferencia revertida"
    assert client.post(path + "/void", headers=headers, json=void).json()["version"] == 3
    assert db.scalar(select(func.count()).select_from(PaymentAllocation)) == 1
    account = client.get("/api/v1/customer-accounts", headers=headers).json()["items"][0]
    assert account["total_received"] == account["available_credit"] == "0.00000000"


@pytest.mark.parametrize(
    "value",
    ["0", "-1", "1.000000001", "NaN", "1,000", 10, True, "1e3", "1000000000000000000000000"],
)
def test_payment_money_validation(client, headers, value):
    customer, _ = make_customer(client, headers)
    post(client, headers, receipt(customer["id"], value), status=422)


def test_exact_eight_decimal_money_and_large_advance(client, headers, db):
    customer, _ = make_customer(client, headers)
    payload = receipt(customer["id"], "999999999999999999999999.99999999")
    payment = post(client, headers, payload)
    assert payment["amount"] == payload["amount"] == payment["available_credit"]
    assert db.get(Payment, UUID(payment["id"])).amount == Decimal(payload["amount"])
    order = make_order(client, headers, customer["id"])
    response = client.post(
        f"/api/v1/payments/{payment['id']}/applications",
        headers=headers,
        json={
            "id": str(uuid4()),
            "application_date": "2026-10-21",
            "description": None,
            "allocations": [{"order_id": order["id"], "amount": "0.00000001"}],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["available_credit"] == "999999999999999999999999.99999998"
    assert read_order(client, headers, order)["remaining_amount"] == "99.99999999"


def test_operator_scope_and_balances_include_team_payments(client, headers, db):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    own = post(client, headers, receipt(customer["id"], "10"))
    admin_id = uuid4()
    db.add(Membership(organization_id=ORG, user_id=admin_id, role="administrator"))
    db.commit()
    admin = Principal(admin_id, ORG, "administrator")
    from app.modules.payment_schemas import ApplicationInput, PaymentInput, VoidInput

    team_payment = payments.create_payment(
        db,
        admin,
        PaymentInput.model_validate(
            receipt(customer["id"], "30", [{"order_id": order["id"], "amount": "30"}])
        ),
    )
    assert read_order(client, headers, order)["total_paid"] == "30.00000000"
    assert client.get(f"/api/v1/payments/{team_payment.id}", headers=headers).status_code == 404
    another = create_order(db, admin, OrderCreate.model_validate(order_payload(customer["id"])))
    payments.apply_credit(
        db,
        admin,
        UUID(own["id"]),
        ApplicationInput.model_validate(
            {
                "id": str(uuid4()),
                "application_date": "2026-10-21",
                "allocations": [{"order_id": str(another.id), "amount": "10"}],
            }
        ),
    )
    visible = client.get(f"/api/v1/payments/{own['id']}", headers=headers).json()
    assert (
        visible["applied_amount"] == "10.00000000"
        and visible["applications"][0]["allocations"] == []
    )
    assert (
        client.post(
            f"/api/v1/payments/{own['id']}/void",
            headers=headers,
            json={"expected_version": 2, "reason": "No autorizado"},
        ).status_code
        == 403
    )
    with pytest.raises(Exception) as error:
        payments.payment_by_id(db, Principal(USER, OTHER_ORG, "administrator"), UUID(own["id"]))
    assert error.value.status_code == 404
    payments.void_payment(
        db, admin, UUID(own["id"]), VoidInput(expected_version=2, reason="Revisión administrativa")
    )


def exercise_postgresql_payment_concurrency(engine, client, headers):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.modules.balances import order_paid
    from app.modules.payment_schemas import PaymentInput

    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    principal = Principal(USER, ORG, "operator")
    barrier = Barrier(2)

    def worker(payload):
        with Session(engine) as session:
            barrier.wait(timeout=10)
            try:
                payments.create_payment(session, principal, PaymentInput.model_validate(payload))
                return 201
            except HTTPException as error:
                session.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                worker,
                [
                    receipt(customer["id"], "100", [{"order_id": order["id"], "amount": "80"}])
                    for _ in range(2)
                ],
            )
        )
    assert sorted(results) == [201, 409]
    with Session(engine) as session:
        assert order_paid(session, UUID(order["id"])) == Decimal("80")
    barrier = Barrier(2)
    payload = receipt(customer["id"], "999999999999999999999999.99999999")
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(worker, [payload, payload])) == [201, 201]
    with Session(engine) as session:
        assert session.get(Payment, UUID(payload["id"])).amount == Decimal(payload["amount"])


def test_legacy_order_retries_and_missing_remission_before_first_payment(client, headers, db):
    from app.modules.operations import fingerprint

    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    stored = db.get(Order, UUID(order["id"]))
    old_body = order_payload(
        customer["id"], id=order["id"], details={"hectares": "1", "unit_price": "100"}
    )
    old_body.pop("remission_number")
    stored.remission_number = None
    stored.creation_hash = fingerprint(OrderCreate.model_validate(old_body))
    db.commit()
    response = client.post("/api/v1/orders", headers=headers, json=old_body)
    assert response.status_code == 201, response.text
    assert response.json()["remission_number"] is None
    allocation = [{"order_id": order["id"], "amount": "10"}]
    post(client, headers, receipt(customer["id"], "10", allocation), status=422)
    edited = client.patch(
        f"/api/v1/orders/{order['id']}",
        headers=headers,
        json=update_payload(order, remission_number=82),
    )
    assert edited.status_code == 200, edited.text
    post(client, headers, receipt(customer["id"], "10", allocation))
    assert read_order(client, headers, order)["total_paid"] == "10.00000000"


def test_void_active_receipt_restores_debt_and_removes_credit(client, headers):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    payment = post(
        client,
        headers,
        receipt(customer["id"], "150", [{"order_id": order["id"], "amount": "100"}]),
    )
    result = client.post(
        f"/api/v1/payments/{payment['id']}/void",
        headers=headers,
        json={"expected_version": 1, "reason": "Transferencia devuelta"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["applied_amount"] == result.json()["available_credit"] == "0.00000000"
    current = read_order(client, headers, order)
    assert current["total_paid"] == "0.00000000"
    assert current["remaining_amount"] == "100.00000000"
    assert result.json()["applications"][0]["allocations"][0]["amount"] == "100.00000000"


@pytest.mark.parametrize("remove", ["void", "unassign"])
def test_order_can_be_deleted_after_removing_all_active_payments(client, headers, db, remove):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    payment = post(
        client,
        headers,
        receipt(customer["id"], "150", [{"order_id": order["id"], "amount": "100"}]),
    )
    endpoint = f"/api/v1/orders/{order['id']}"
    current = read_order(client, headers, order)
    blocked = client.delete(endpoint + f"?expected_version={current['version']}", headers=headers)
    assert blocked.status_code == 409
    assert "vigentes" in blocked.json()["detail"]
    path = f"/api/v1/payments/{payment['id']}"
    action = path + ("/void" if remove == "void" else f"/applications/{payment['id']}/void")
    removed = client.post(
        action, headers=headers, json={"expected_version": 1, "reason": "Corrección de captura"}
    )
    assert removed.status_code == 200, removed.text
    current = read_order(client, headers, order)
    assert current["total_paid"] == "0.00000000"
    assert client.delete(endpoint + "?expected_version=1", headers=headers).status_code == 409
    deleted = client.delete(endpoint + f"?expected_version={current['version']}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    assert client.get(endpoint, headers=headers).status_code == 410
    assert db.get(Order, UUID(order["id"])).deleted_at is not None
    assert db.scalar(select(func.count()).select_from(PaymentAllocation)) == 1
    history = client.get(path, headers=headers).json()
    line = history["applications"][0]["allocations"][0]
    assert line["order_id"] == order["id"] and line["order_deleted"]
    assert line["remission_number"] == order["remission_number"]
    assert history["available_credit"] == ("0.00000000" if remove == "void" else "150.00000000")


@pytest.mark.parametrize("remove", ["void", "unassign"])
def test_reusing_remission_preserves_old_payment_references(client, headers, db, remove):
    test_order_can_be_deleted_after_removing_all_active_payments(client, headers, db, remove)
    previous = db.scalar(select(Order).where(Order.deleted_at.is_not(None)))
    payment = db.scalar(select(Payment))
    replacement = make_order(
        client, headers, str(previous.customer_id), remission_number=previous.remission_number
    )
    assert replacement["id"] != str(previous.id)
    assert replacement["total_paid"] == "0.00000000"
    history = client.get(f"/api/v1/payments/{payment.id}", headers=headers).json()
    line = history["applications"][0]["allocations"][0]
    assert line["order_id"] == str(previous.id) and line["order_deleted"]
    assert line["remission_number"] == replacement["remission_number"]
    assert history["available_credit"] == ("0.00000000" if remove == "void" else "150.00000000")


def test_voiding_one_of_two_payments_does_not_unlock_order_deletion(client, headers):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    first = post(
        client, headers, receipt(customer["id"], "30", [{"order_id": order["id"], "amount": "30"}])
    )
    second = post(
        client, headers, receipt(customer["id"], "20", [{"order_id": order["id"], "amount": "20"}])
    )
    client.post(
        f"/api/v1/payments/{first['id']}/void",
        headers=headers,
        json={"expected_version": 1, "reason": "Duplicado"},
    )
    current = read_order(client, headers, order)
    assert current["total_paid"] == "20.00000000"
    endpoint = f"/api/v1/orders/{order['id']}"
    assert (
        client.delete(
            endpoint + f"?expected_version={current['version']}", headers=headers
        ).status_code
        == 409
    )
    client.post(
        f"/api/v1/payments/{second['id']}/void",
        headers=headers,
        json={"expected_version": 1, "reason": "Pedido cancelado"},
    )
    current = read_order(client, headers, order)
    assert (
        client.delete(
            endpoint + f"?expected_version={current['version']}", headers=headers
        ).status_code
        == 200
    )


def test_history_does_not_allow_changing_order_identity_after_void(client, headers):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    payment = post(
        client, headers, receipt(customer["id"], "10", [{"order_id": order["id"], "amount": "10"}])
    )
    client.post(
        f"/api/v1/payments/{payment['id']}/void",
        headers=headers,
        json={"expected_version": 1, "reason": "Pedido cancelado"},
    )
    current = read_order(client, headers, order)
    assert (
        client.patch(
            f"/api/v1/orders/{order['id']}",
            headers=headers,
            json=update_payload(current, remission_number=55),
        ).status_code
        == 409
    )


def test_application_exceeding_credit_changes_neither_order_nor_receipt(client, headers):
    customer, _ = make_customer(client, headers)
    order = make_order(client, headers, customer["id"])
    payment = post(client, headers, receipt(customer["id"], "50"))
    result = client.post(
        f"/api/v1/payments/{payment['id']}/applications",
        headers=headers,
        json={
            "id": str(uuid4()),
            "application_date": "2026-10-20",
            "description": None,
            "allocations": [{"order_id": order["id"], "amount": "60"}],
        },
    )
    assert result.status_code == 409, result.text
    assert read_order(client, headers, order)["version"] == 1
    assert (
        client.get(f"/api/v1/payments/{payment['id']}", headers=headers).json()["available_credit"]
        == "50.00000000"
    )


@pytest.mark.parametrize("value", ["0", "-1"])
def test_database_enforces_positive_payment_amount(db, client, headers, value):
    from sqlalchemy.exc import IntegrityError

    customer, _ = make_customer(client, headers)
    db.add(
        Payment(
            id=uuid4(),
            organization_id=ORG,
            customer_id=UUID(customer["id"]),
            amount=Decimal(value),
            payment_date=date(2026, 10, 20),
            created_by=USER,
            creation_hash="a" * 64,
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()

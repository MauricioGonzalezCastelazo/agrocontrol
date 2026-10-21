import hashlib
from decimal import Decimal
from itertools import count
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.api.dependencies import Principal
from app.modules.operations import create_order
from app.modules.schemas import OrderCreate, calculate_total
from app.persistence.models import AuditEvent, Customer, Membership, Order
from tests.conftest import ORG, OTHER_ORG, USER


def make_customer(client, headers, **changes):
    payload = {"id": str(uuid4()), "name": "Cliente sintético", "notes": None, "active": True}
    payload.update(changes)
    response = client.post("/api/v1/customers", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json(), payload


_remissions = count(1000)


def order_payload(customer_id, **changes):
    data = {
        "id": str(uuid4()),
        "customer_id": customer_id,
        "remission_number": next(_remissions),
        "product_type": "carrot",
        "order_date": "2026-03-12",
        "description": "Retiro de prueba",
        "details": {"hectares": "1.2500", "unit_price": "100.5000"},
        "attachments": [],
    }
    data.update(changes)
    return data


@pytest.mark.parametrize(
    ("hectares", "price", "expected"),
    [
        ("0.1", "0.2", "0.02000000"),
        ("1.25", "100.50", "125.62500000"),
        ("0.0001", "0.0001", "0.00000001"),
        ("2.5", "0", "0.00000000"),
        ("9999999999.9999", "99999999999999.9999", "999999999999989999000000.00000001"),
    ],
)
def test_decimal_calculation_never_uses_float(hectares, price, expected):
    total = calculate_total(Decimal(hectares), Decimal(price))
    assert total == Decimal(expected)
    assert total.as_tuple().exponent == -8


def test_customer_create_search_edit_and_conflict(client, db, headers):
    customer, payload = make_customer(client, headers, name="  María del Campo  ")
    assert customer["name"] == "María del Campo"
    assert client.get("/api/v1/customers?q=MAR", headers=headers).json()["total"] == 1
    assert (
        client.get(f"/api/v1/customers/{customer['id']}", headers=headers).json()["id"]
        == customer["id"]
    )
    assert (
        client.patch(
            f"/api/v1/customers/{customer['id']}",
            headers=headers,
            json={"name": "Cambio", "notes": None, "active": True, "expected_version": 1},
        ).status_code
        == 403
    )
    db.get(Membership, (ORG, USER)).role = "administrator"
    db.commit()
    change = {"name": "María editada", "notes": "Nota", "active": False, "expected_version": 1}
    updated = client.patch(f"/api/v1/customers/{customer['id']}", headers=headers, json=change)
    assert updated.status_code == 200 and updated.json()["version"] == 2
    assert (
        client.patch(
            f"/api/v1/customers/{customer['id']}", headers=headers, json=change
        ).status_code
        == 409
    )
    assert client.post("/api/v1/customers", headers=headers, json=payload).json()["version"] == 2
    assert db.scalar(select(func.count()).select_from(Customer)) == 1
    assert db.scalar(select(func.count()).select_from(AuditEvent)) == 2


@pytest.mark.parametrize(
    "changes",
    [{"name": " "}, {"active": "true"}, {"organization_id": str(OTHER_ORG)}, {"name": "x" * 201}],
)
def test_customer_strict_validation(client, headers, changes):
    payload = {"id": str(uuid4()), "name": "Cliente", **changes}
    assert client.post("/api/v1/customers", headers=headers, json=payload).status_code == 422


def test_customer_cross_organization_not_found(client, db, headers):
    customer = Customer(organization_id=OTHER_ORG, name="Cliente ajeno")
    db.add(customer)
    db.commit()
    assert client.get(f"/api/v1/customers/{customer.id}", headers=headers).status_code == 404
    assert client.get("/api/v1/customers", headers=headers).json()["total"] == 0


def test_order_persistence_date_total_and_idempotency(client, db, headers):
    customer, _ = make_customer(client, headers)
    payload = order_payload(customer["id"])
    created = client.post("/api/v1/orders", headers=headers, json=payload)
    assert created.status_code == 201, created.text
    result = created.json()
    assert result["order_date"] == "2026-03-12" and result["currency"] == "MXN"
    assert result["total_amount"] == "125.62500000" and result["created_by"] == str(USER)
    assert result["attachment_status"] == "complete"
    assert (
        client.get(f"/api/v1/orders/{result['id']}", headers=headers).json()["description"]
        == "Retiro de prueba"
    )
    assert client.post("/api/v1/orders", headers=headers, json=payload).json()["id"] == result["id"]
    assert db.scalar(select(func.count()).select_from(Order)) == 1
    assert (
        db.scalar(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "order.created")
        )
        == 1
    )
    payload["description"] = "Contenido distinto"
    assert client.post("/api/v1/orders", headers=headers, json=payload).status_code == 409
    assert (
        client.get("/api/v1/orders?q=sintético&product_type=carrot", headers=headers).json()[
            "total"
        ]
        == 1
    )
    assert client.get("/api/v1/orders?product_type=potato", headers=headers).json()["total"] == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"product_type": "potato"},
        {"order_date": "2026-02-30"},
        {"total_amount": "0.01"},
        {"created_by": str(uuid4())},
        {"organization_id": str(OTHER_ORG)},
        {"details": {"hectares": "0", "unit_price": "2"}},
        {"details": {"hectares": "-1", "unit_price": "2"}},
        {"details": {"hectares": "NaN", "unit_price": "2"}},
        {"details": {"hectares": "1e2", "unit_price": "2"}},
        {"details": {"hectares": "1.12345", "unit_price": "2"}},
        {"details": {"hectares": 1.25, "unit_price": "2"}},
        {"details": {"hectares": "1", "unit_price": "Infinity"}},
        {"details": {"hectares": "1", "unit_price": "100000000000000.0000"}},
    ],
)
def test_order_rejects_invalid_input_and_client_calculated_values(client, headers, changes):
    customer, _ = make_customer(client, headers)
    assert (
        client.post(
            "/api/v1/orders", headers=headers, json=order_payload(customer["id"], **changes)
        ).status_code
        == 422
    )


def test_inactive_or_other_organization_customer_cannot_be_ordered(client, db, headers):
    customer, _ = make_customer(client, headers, active=False)
    assert (
        client.post(
            "/api/v1/orders", headers=headers, json=order_payload(customer["id"])
        ).status_code
        == 409
    )
    foreign = Customer(organization_id=OTHER_ORG, name="Ajeno")
    db.add(foreign)
    db.commit()
    assert (
        client.post(
            "/api/v1/orders", headers=headers, json=order_payload(str(foreign.id))
        ).status_code
        == 404
    )


def test_operator_cannot_read_another_operators_order(client, db, headers):
    customer, _ = make_customer(client, headers)
    other_user = uuid4()
    db.add(Membership(organization_id=ORG, user_id=other_user, role="operator"))
    db.commit()
    other = create_order(
        db,
        Principal(other_user, ORG, "operator"),
        OrderCreate.model_validate(order_payload(customer["id"])),
    )
    assert client.get(f"/api/v1/orders/{other.id}", headers=headers).status_code == 404
    assert client.get("/api/v1/orders", headers=headers).json()["total"] == 0
    db.get(Membership, (ORG, USER)).role = "administrator"
    db.commit()
    assert client.get(f"/api/v1/orders/{other.id}", headers=headers).status_code == 200


def test_attachment_manifest_validation(client, headers):
    customer, _ = make_customer(client, headers)
    manifest = {
        "id": str(uuid4()),
        "filename": "../../file.pdf",
        "size_bytes": 5,
        "sha256": "a" * 64,
    }
    payload = order_payload(customer["id"], attachments=[manifest])
    assert client.post("/api/v1/orders", headers=headers, json=payload).status_code == 422
    manifest["filename"] = "nota.pdf"
    manifest["size_bytes"] = 26 * 1024 * 1024
    assert client.post("/api/v1/orders", headers=headers, json=payload).status_code == 422
    manifest["size_bytes"] = 5
    payload["attachments"] = [manifest, manifest]
    assert client.post("/api/v1/orders", headers=headers, json=payload).status_code == 422


def exercise_private_attachment(
    client, headers, content=b"<html>synthetic document</html>", filename="documento.txt"
):
    customer, _ = make_customer(client, headers)
    manifest = {
        "id": str(uuid4()),
        "filename": filename,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    response = client.post(
        "/api/v1/orders",
        headers=headers,
        json=order_payload(customer["id"], attachments=[manifest]),
    )
    assert response.status_code == 201, response.text
    order = response.json()
    endpoint = f"/api/v1/orders/{order['id']}/attachments/{manifest['id']}"
    assert order["attachment_status"] == "pending"
    assert client.get(endpoint + "/download", headers=headers).status_code == 404
    assert client.put(endpoint, headers=headers, content=b"x" * len(content)).status_code == 422
    assert (
        client.get(f"/api/v1/orders/{order['id']}", headers=headers).json()["attachment_status"]
        == "pending"
    )
    assert client.put(endpoint, headers=headers, content=content).status_code == 200
    complete = client.get(f"/api/v1/orders/{order['id']}", headers=headers).json()
    assert complete["attachment_status"] == "complete"
    version = complete["version"]
    assert client.put(endpoint, headers=headers, content=content).status_code == 200
    assert client.get(f"/api/v1/orders/{order['id']}", headers=headers).json()["version"] == version
    downloaded = client.get(endpoint + "/download", headers=headers)
    assert downloaded.content == content
    assert downloaded.headers["content-type"] == "application/octet-stream"
    assert downloaded.headers["content-disposition"].startswith("attachment;")
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert downloaded.headers["cache-control"] == "no-store"
    assert (
        client.get(endpoint + "/download", headers={"X-Organization-ID": str(ORG)}).status_code
        == 401
    )
    return order


def test_private_file_upload_checksum_retry_and_forced_download(
    client, headers, tmp_path, monkeypatch
):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "private_files_path", tmp_path)
    exercise_private_attachment(client, headers)
    assert len(list(tmp_path.rglob("*.part"))) == 0


def test_one_failed_attachment_keeps_order_pending(client, headers, tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "private_files_path", tmp_path)
    customer, _ = make_customer(client, headers)
    content = b"synthetic"
    manifests = [
        {
            "id": str(uuid4()),
            "filename": f"archivo{i}.txt",
            "size_bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        for i in range(2)
    ]
    order = client.post(
        "/api/v1/orders", headers=headers, json=order_payload(customer["id"], attachments=manifests)
    ).json()
    assert (
        client.put(
            f"/api/v1/orders/{order['id']}/attachments/{manifests[0]['id']}",
            headers=headers,
            content=content,
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/orders/{order['id']}", headers=headers).json()["attachment_status"]
        == "pending"
    )

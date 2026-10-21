import hashlib
from uuid import UUID, uuid4

from sqlalchemy import func, select

from app.api.dependencies import Principal
from app.modules.operations import create_order
from app.modules.schemas import OrderCreate
from app.persistence.models import Attachment, AuditEvent, Customer, Membership, Order
from tests.conftest import ORG, OTHER_ORG, USER
from tests.test_operations import make_customer, order_payload


def update_payload(order, **changes):
    return {
        "customer_id": order["customer_id"],
        "product_type": "carrot",
        "order_date": "2026-10-18",
        "description": "Descripción editada",
        "details": {"hectares": "2.5", "unit_price": "200.20"},
        "attachments": [
            {key: file[key] for key in ("id", "filename", "size_bytes", "sha256")}
            for file in order["attachments"]
        ],
        "expected_version": order["version"],
        **changes,
    }


def test_order_edit_exact_total_idempotency_and_stale_version(client, db, headers):
    customer, _ = make_customer(client, headers)
    original = order_payload(customer["id"])
    order = client.post("/api/v1/orders", headers=headers, json=original).json()
    path = f"/api/v1/orders/{order['id']}"
    payload = update_payload(order)
    updated = client.patch(path, headers=headers, json=payload)
    assert updated.status_code == 200, updated.text
    record = updated.json()
    assert record["total_amount"] == "500.50000000"
    assert record["order_date"] == "2026-10-18" and record["description"] == "Descripción editada"
    assert record["version"] == 2 and record["created_at"] == order["created_at"]
    assert client.patch(path, headers=headers, json=payload).json() == record
    assert (
        client.patch(
            path, headers=headers, json={**payload, "description": "Cambio obsoleto"}
        ).status_code
        == 409
    )
    assert client.get(path, headers=headers).json() == record
    assert (
        db.scalar(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "order.updated")
        )
        == 1
    )
    # A delayed retry of the creation must return the current edited record.
    assert (
        client.post("/api/v1/orders", headers=headers, json=original).json()["total_amount"]
        == "500.50000000"
    )


def test_order_changes_customer_only_to_active_same_organization(client, db, headers):
    first, _ = make_customer(client, headers)
    second, _ = make_customer(client, headers, name="Cliente segundo")
    inactive, _ = make_customer(client, headers, name="Inactivo", active=False)
    foreign = Customer(organization_id=OTHER_ORG, name="Ajeno")
    db.add(foreign)
    db.commit()
    order = client.post("/api/v1/orders", headers=headers, json=order_payload(first["id"])).json()
    path = f"/api/v1/orders/{order['id']}"
    assert (
        client.patch(
            path, headers=headers, json=update_payload(order, customer_id=inactive["id"])
        ).status_code
        == 409
    )
    assert (
        client.patch(
            path, headers=headers, json=update_payload(order, customer_id=str(foreign.id))
        ).status_code
        == 404
    )
    assert client.get(path, headers=headers).json()["version"] == 1
    changed = client.patch(
        path, headers=headers, json=update_payload(order, customer_id=second["id"])
    )
    assert changed.status_code == 200
    assert changed.json()["customer_name"] == "Cliente segundo"
    assert (
        client.patch(
            path, headers=headers, json={**update_payload(changed.json()), "total_amount": "1"}
        ).status_code
        == 422
    )


def test_deleted_customer_hides_from_directory_but_preserves_orders(client, db, headers):
    customer, original = make_customer(client, headers)
    order = client.post(
        "/api/v1/orders", headers=headers, json=order_payload(customer["id"])
    ).json()
    path = f"/api/v1/customers/{customer['id']}"
    assert client.delete(path + "?expected_version=1", headers=headers).status_code == 403
    db.get(Membership, (ORG, USER)).role = "administrator"
    db.commit()
    assert client.delete(path + "?expected_version=2", headers=headers).status_code == 409
    assert client.delete(path + "?expected_version=1", headers=headers).status_code == 200
    assert client.delete(path + "?expected_version=1", headers=headers).status_code == 200
    assert client.get("/api/v1/customers", headers=headers).json()["total"] == 0
    assert client.get(path, headers=headers).status_code == 410
    assert (
        client.patch(
            path,
            headers=headers,
            json={"name": "Resucitado", "active": True, "expected_version": 2},
        ).status_code
        == 410
    )
    assert client.post("/api/v1/customers", headers=headers, json=original).status_code == 410
    assert (
        client.post(
            "/api/v1/orders", headers=headers, json=order_payload(customer["id"])
        ).status_code
        == 409
    )
    history = client.get(f"/api/v1/orders/{order['id']}", headers=headers)
    assert history.status_code == 200 and history.json()["customer_name"] == customer["name"]
    assert (
        client.patch(
            f"/api/v1/orders/{order['id']}", headers=headers, json=update_payload(order)
        ).status_code
        == 200
    )
    assert (
        db.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.action == "customer.deleted")
        )
        == 1
    )


def test_deleted_order_denies_files_edits_and_creation_retry(
    client, db, headers, tmp_path, monkeypatch
):
    from app.core.config import get_settings
    from tests.test_operations import exercise_private_attachment

    monkeypatch.setattr(get_settings(), "private_files_path", tmp_path)
    order = exercise_private_attachment(client, headers)
    path = f"/api/v1/orders/{order['id']}"
    current = client.get(path, headers=headers).json()
    assert client.delete(path + "?expected_version=1", headers=headers).status_code == 409
    assert (
        client.delete(path + f"?expected_version={current['version']}", headers=headers).status_code
        == 200
    )
    assert (
        client.delete(path + f"?expected_version={current['version']}", headers=headers).status_code
        == 200
    )
    assert client.get("/api/v1/orders", headers=headers).json()["total"] == 0
    assert client.get(path, headers=headers).status_code == 410
    assert client.patch(path, headers=headers, json=update_payload(current)).status_code == 410
    endpoint = path + f"/attachments/{current['attachments'][0]['id']}"
    assert client.get(endpoint + "/download", headers=headers).status_code == 410
    assert client.put(endpoint, headers=headers, content=b"anything").status_code == 410
    original = order_payload(
        current["customer_id"],
        id=order["id"],
        remission_number=current["remission_number"],
        attachments=update_payload(current)["attachments"],
    )
    assert client.post("/api/v1/orders", headers=headers, json=original).status_code == 410
    assert db.get(Order, UUID(order["id"])).deleted_at is not None
    assert (
        db.scalar(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "order.deleted")
        )
        == 1
    )


def test_edit_replaces_attachments_atomically_and_removed_upload_cannot_return(
    client, db, headers, tmp_path, monkeypatch
):
    from app.core.config import get_settings
    from tests.test_operations import exercise_private_attachment

    monkeypatch.setattr(get_settings(), "private_files_path", tmp_path)
    order = exercise_private_attachment(client, headers)
    path = f"/api/v1/orders/{order['id']}"
    current = client.get(path, headers=headers).json()
    old = current["attachments"][0]
    changed_manifest = {**update_payload(current)["attachments"][0], "filename": "manipulado.pdf"}
    assert (
        client.patch(
            path, headers=headers, json=update_payload(current, attachments=[changed_manifest])
        ).status_code
        == 409
    )
    assert client.get(path, headers=headers).json() == current
    data = b"replacement document"
    new = {
        "id": str(uuid4()),
        "filename": "nuevo.docx",
        "size_bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    payload = update_payload(current, attachments=[new])
    changed = client.patch(path, headers=headers, json=payload)
    assert changed.status_code == 200, changed.text
    assert changed.json()["attachment_status"] == "pending"
    old_endpoint = path + f"/attachments/{old['id']}"
    assert client.get(old_endpoint + "/download", headers=headers).status_code == 410
    assert client.put(old_endpoint, headers=headers, content=b"x").status_code == 410
    assert (
        client.put(path + f"/attachments/{new['id']}", headers=headers, content=data).status_code
        == 200
    )
    ready = client.get(path, headers=headers).json()
    assert ready["attachment_status"] == "complete" and len(ready["attachments"]) == 1
    assert client.patch(path, headers=headers, json=payload).json() == ready
    assert db.get(Attachment, UUID(old["id"])).deleted_at is not None
    assert (
        client.patch(
            path,
            headers=headers,
            json=update_payload(
                ready,
                attachments=[{key: old[key] for key in ("id", "filename", "size_bytes", "sha256")}],
            ),
        ).status_code
        == 409
    )


def test_edit_delete_keep_operator_and_organization_boundaries(client, db, headers):
    customer, _ = make_customer(client, headers)
    other_user = uuid4()
    db.add(Membership(organization_id=ORG, user_id=other_user, role="operator"))
    db.commit()
    record = create_order(
        db,
        Principal(other_user, ORG, "operator"),
        OrderCreate.model_validate(order_payload(customer["id"])),
    )
    path = f"/api/v1/orders/{record.id}"
    own_format = client.post(
        "/api/v1/orders", headers=headers, json=order_payload(customer["id"])
    ).json()
    assert client.patch(path, headers=headers, json=update_payload(own_format)).status_code == 404
    assert client.delete(path + "?expected_version=1", headers=headers).status_code == 404
    db.get(Membership, (ORG, USER)).role = "administrator"
    db.commit()
    other = client.get(path, headers=headers).json()
    assert client.patch(path, headers=headers, json=update_payload(other)).status_code == 200
    assert client.delete(path + "?expected_version=2", headers=headers).status_code == 200
    foreign = Customer(organization_id=OTHER_ORG, name="Ajeno")
    db.add(foreign)
    db.commit()
    assert (
        client.delete(
            f"/api/v1/customers/{foreign.id}?expected_version=1", headers=headers
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/v1/customers/{customer['id']}?expected_version=1",
            headers={"X-Organization-ID": str(ORG)},
        ).status_code
        == 401
    )


def test_cors_allows_authenticated_delete(client):
    response = client.options(
        "/api/v1/orders/11111111-1111-4111-8111-111111111111",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "Authorization,X-Organization-ID",
        },
    )
    assert (
        response.status_code == 200 and "DELETE" in response.headers["access-control-allow-methods"]
    )

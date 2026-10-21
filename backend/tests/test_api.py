from fastapi import Depends

from app.api.dependencies import administrator
from app.persistence.models import Membership
from tests.conftest import ORG, OTHER_ORG, USER


def test_health_and_security_headers(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert client.get("/health/ready").status_code == 200


def test_session_requires_identity(client, headers):
    headers.pop("Authorization")
    assert client.get("/api/v1/session", headers=headers).status_code == 401


def test_session_rejects_invalid_token(client, headers):
    headers["Authorization"] = "Bearer invalid"
    assert client.get("/api/v1/session", headers=headers).status_code == 401


def test_session_returns_server_membership(client, headers):
    response = client.get("/api/v1/session", headers=headers)
    assert response.status_code == 200
    assert response.json() == {
        "user_id": str(USER),
        "organization_id": str(ORG),
        "role": "operator",
    }


def test_client_cannot_choose_another_organization(client, headers):
    headers["X-Organization-ID"] = str(OTHER_ORG)
    assert client.get("/api/v1/session", headers=headers).status_code == 403


def test_inactive_membership_denies_access(client, db, headers):
    db.get(Membership, (ORG, USER)).active = False
    db.commit()
    assert client.get("/api/v1/session", headers=headers).status_code == 403


def test_administrator_guard_does_not_trust_browser_role(client, headers):
    @client.app.get("/test-admin", dependencies=[Depends(administrator)])
    def admin_only():
        return {"ok": True}

    headers["X-Role"] = "administrator"
    assert client.get("/test-admin", headers=headers).status_code == 403


def test_administrator_guard_allows_database_role(client, db, headers):
    db.get(Membership, (ORG, USER)).role = "administrator"
    db.commit()

    @client.app.get("/test-admin", dependencies=[Depends(administrator)])
    def admin_only():
        return {"ok": True}

    assert client.get("/test-admin", headers=headers).status_code == 200


def test_organization_header_is_uuid(client, headers):
    headers["X-Organization-ID"] = "arbitrary"
    assert client.get("/api/v1/session", headers=headers).status_code == 422


def test_customer_creation_requires_explicit_uuid(client, headers):
    assert (
        client.post("/api/v1/customers", headers=headers, json={"name": "Prueba"}).status_code
        == 422
    )

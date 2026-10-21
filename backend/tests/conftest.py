from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_identity_provider
from app.auth.provider import Identity, InvalidIdentity
from app.main import create_app
from app.persistence.base import Base
from app.persistence.database import get_db
from app.persistence.models import Membership, Organization

ORG = UUID("10000000-0000-4000-8000-000000000001")
OTHER_ORG = UUID("10000000-0000-4000-8000-000000000002")
USER = UUID("20000000-0000-4000-8000-000000000001")


def pytest_configure(config):
    if not config.option.basetemp:
        root = Path(__file__).resolve().parents[2]
        target = (root / ".local" / "pytest" / uuid4().hex).resolve()
        assert root in target.parents
        target.parent.mkdir(parents=True, exist_ok=True)
        config.option.basetemp = str(target)


class TestIdentityProvider:
    def verify(self, token: str) -> Identity:
        if token != "test-identity-token":
            raise InvalidIdentity
        return Identity(USER)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                Organization(id=ORG, name="Empresa de prueba"),
                Organization(id=OTHER_ORG, name="Otra empresa"),
            ]
        )
        session.flush()
        session.add(Membership(organization_id=ORG, user_id=USER, role="operator"))
        session.commit()
        yield session
    engine.dispose()


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_identity_provider] = TestIdentityProvider
    with TestClient(app) as client:
        yield client


@pytest.fixture
def headers():
    return {"Authorization": "Bearer test-identity-token", "X-Organization-ID": str(ORG)}

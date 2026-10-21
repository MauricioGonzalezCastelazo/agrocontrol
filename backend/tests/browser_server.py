"""Isolated browser-test harness. Not imported or shipped by the production app."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from secrets import token_urlsafe
from tempfile import TemporaryDirectory
from uuid import UUID

import jwt
import uvicorn
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session


def main():
    if os.environ.get("AGROCONTROL_BROWSER_TEST") != "1":
        raise RuntimeError("This harness requires an explicit browser-test invocation")

    from app.api.dependencies import get_identity_provider
    from app.auth.provider import Identity, InvalidIdentity
    from app.core.config import get_settings
    from app.main import create_app
    from app.persistence.base import Base
    from app.persistence.database import get_db
    from app.persistence.models import Membership, Organization

    root = Path(__file__).resolve().parents[2]
    temporary_root = root / ".local"
    temporary_root.mkdir(exist_ok=True)
    organization_id = UUID("10000000-0000-4000-8000-000000000001")
    user_id = UUID("20000000-0000-4000-8000-000000000001")
    signing_key = token_urlsafe(48)
    with TemporaryDirectory(prefix="browser-test-", dir=temporary_root) as temporary:
        settings = get_settings()
        settings.cors_origins = ["http://127.0.0.1:5175"]
        settings.private_files_path = Path(temporary) / "files"
        engine = create_engine(
            f"sqlite:///{Path(temporary).as_posix()}/test.db",
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, record):
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add(Organization(id=organization_id, name="Browser test only"))
            db.flush()
            db.add(
                Membership(organization_id=organization_id, user_id=user_id, role="administrator")
            )
            db.commit()

        def database():
            with Session(engine) as db:
                yield db

        class TestIdentity:
            def verify(self, token):
                try:
                    claims = jwt.decode(
                        token, signing_key, algorithms=["HS256"], audience="authenticated"
                    )
                    return Identity(UUID(claims["sub"]))
                except (jwt.PyJWTError, ValueError, KeyError) as exc:
                    raise InvalidIdentity from exc

        application = create_app()
        application.dependency_overrides[get_db] = database
        application.dependency_overrides[get_identity_provider] = TestIdentity

        @application.get("/__test__/identity")
        def test_identity():
            now = datetime.now(UTC)
            token = jwt.encode(
                {
                    "sub": str(user_id),
                    "aud": "authenticated",
                    "iat": now,
                    "exp": now + timedelta(hours=1),
                },
                signing_key,
                algorithm="HS256",
            )
            return {
                "access_token": token,
                "refresh_token": "isolated-test-refresh-token",
                "token_type": "bearer",
                "expires_in": 3600,
                "user": {
                    "id": str(user_id),
                    "aud": "authenticated",
                    "role": "authenticated",
                    "email": "test@example.test",
                    "app_metadata": {},
                    "user_metadata": {},
                },
            }

        try:
            uvicorn.run(application, host="127.0.0.1", port=8101, access_log=False)
        finally:
            engine.dispose()


if __name__ == "__main__":
    main()

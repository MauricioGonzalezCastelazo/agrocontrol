import json
import os
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.api.dependencies import Principal
from app.local.database import sqlite_engine
from app.local.models import CaptureStore, Installation, StorageIdentity
from app.local.preservation import check_ready_documents, check_sqlite, preserve_sqlite, utc_now
from app.persistence.models import Membership, Organization


class LocalRuntime:
    def __init__(self, directory: Path, origin: str, bootstrap: str):
        parsed = urlsplit(origin)
        if (
            not directory.is_absolute()
            or parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or not parsed.port
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Local runtime needs an absolute directory and a loopback origin")
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory = directory.resolve()
        self.files = self.directory / "attachments"
        self.files.mkdir(exist_ok=True, mode=0o700)
        database = self.directory / "agrocontrol.sqlite3"
        try:
            descriptor = os.open(database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
        except FileExistsError:
            pass
        self.engine = sqlite_engine(database)
        self.origin = origin
        self.bootstrap = bootstrap
        self.bootstrap_expires = time.monotonic() + 600
        self.sessions = {}
        self.lock = threading.Lock()
        self.principal = None

    def initialize(self):
        with self.engine.connect().execution_options(sqlite_write=True) as connection:
            connection.begin()
            config = Config(str(Path(__file__).resolve().parents[2] / "alembic.local.ini"))
            # Check before any DDL. Keep writers blocked through copy + migration.
            check_sqlite(connection.connection.driver_connection)
            current = MigrationContext.configure(connection).get_current_heads()
            if not current and "customers" in inspect(connection).get_table_names():
                raise RuntimeError("Existing unversioned SQLite database; migration stopped")
            scripts = ScriptDirectory.from_config(config)
            for revision in current:
                scripts.get_revision(revision)
            if current and set(current) != set(scripts.get_heads()):
                for table, staged in (("attachments", False), ("local_blobs", True)):
                    if table in inspect(connection).get_table_names():
                        check_ready_documents(
                            connection.execute(text(f"SELECT * FROM {table}")).mappings(),
                            self.files,
                            staged=staged,
                        )
                preserve_sqlite(self.directory / "agrocontrol.sqlite3", self.files, list(current))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
        with Session(self.engine) as db:
            db.connection(execution_options={"sqlite_write": True})
            if db.get(StorageIdentity, 1) is None:
                db.add(
                    StorageIdentity(
                        id=1,
                        installation_id=str(uuid4()),
                        metadata_created_at_utc=utc_now(),
                        manifest_format_version=1,
                        external_backup_state="pending",
                    )
                )
                db.flush()
            installation = db.get(Installation, 1)
            if installation is None:
                org, user = uuid4(), uuid4()
                db.add(Organization(id=org, name="Mi operación local"))
                db.flush()
                db.add(Membership(organization_id=org, user_id=user, role="administrator"))
                installation = Installation(id=1, organization_id=str(org), user_id=str(user))
                db.add(installation)
                db.add(
                    CaptureStore(
                        id=1,
                        revision=0,
                        data=json.dumps({"files": [], "drafts": [], "payments": []}),
                    )
                )
                db.commit()
            else:
                db.commit()
            self.principal = Principal(
                UUID(installation.user_id), UUID(installation.organization_id), "administrator"
            )
            if db.execute(text("PRAGMA foreign_key_check")).first():
                raise RuntimeError("Local database has broken references; initialization stopped")
            if db.scalar(text("PRAGMA quick_check")) != "ok":
                raise RuntimeError("Local database integrity check failed; initialization stopped")

    def exchange(self, token):
        with self.lock:
            if (
                not self.bootstrap
                or time.monotonic() > self.bootstrap_expires
                or not secrets.compare_digest(token, self.bootstrap)
            ):
                return None
            self.bootstrap = ""
            session = secrets.token_urlsafe(32)
            csrf = secrets.token_urlsafe(32)
            self.sessions[session] = (csrf, time.monotonic() + 12 * 60 * 60)
            return session, csrf

    def session(self, cookie):
        with self.lock:
            value = self.sessions.get(cookie or "")
            if value is None or value[1] < time.monotonic():
                self.sessions.pop(cookie or "", None)
                return None
            return value[0]

    def status(self, db):
        from app.persistence.models import Customer, Order, Payment

        empty = all(
            db.scalar(select(model.id).limit(1)) is None for model in (Customer, Order, Payment)
        )
        return {"business_empty": empty, "storage": "sqlite", "external_backup": "pending"}

    def close(self):
        self.engine.dispose()
        self.sessions.clear()

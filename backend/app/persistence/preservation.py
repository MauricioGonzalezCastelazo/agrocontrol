"""Fail-closed preservation before upgrading an existing PostgreSQL installation."""

import os
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.local.preservation import (
    check_ready_documents,
    copy_documents,
    file_hash,
    seal_manifest,
    utc_now,
    verify_snapshot,
)


def before_postgresql_upgrade(connection, config):
    current = MigrationContext.configure(connection).get_current_heads()
    scripts = ScriptDirectory.from_config(config)
    for revision in current:
        scripts.get_revision(revision)
    tables = inspect(connection).get_table_names()
    if not current:
        if "customers" in tables:
            raise RuntimeError("Existing unversioned database; migration stopped")
        return
    if set(current) == set(scripts.get_heads()):
        return
    if os.environ.get("AGROCONTROL_PG_MAINTENANCE") != "true":
        raise RuntimeError(
            "Stop private API and enable AGROCONTROL_PG_MAINTENANCE=true "
            "before upgrading existing data"
        )
    dump, restore = shutil.which("pg_dump"), shutil.which("pg_restore")
    if not dump or not restore:
        raise RuntimeError(
            "pg_dump and pg_restore are required before migrating existing PostgreSQL data"
        )
    # SHARE allows the dump's reads, blocks all DML through the end of migration.
    quoted = ", ".join(connection.dialect.identifier_preparer.quote(name) for name in tables)
    connection.exec_driver_sql(f"LOCK TABLE {quoted} IN SHARE MODE")
    inspector = inspect(connection)
    quote = connection.dialect.identifier_preparer.quote
    for table in tables:
        for foreign_key in inspector.get_foreign_keys(table):
            columns = foreign_key["constrained_columns"]
            target = foreign_key["referred_table"]
            joins = " AND ".join(
                f"c.{quote(child)} = p.{quote(parent)}"
                for child, parent in zip(columns, foreign_key["referred_columns"], strict=True)
            )
            present = " AND ".join(f"c.{quote(column)} IS NOT NULL" for column in columns)
            missing = f"p.{quote(foreign_key['referred_columns'][0])} IS NULL"
            if connection.scalar(
                text(
                    f"SELECT count(*) FROM {quote(table)} c LEFT JOIN {quote(target)} p "
                    f"ON {joins} WHERE {present} AND {missing}"
                )
            ):
                raise RuntimeError(
                    "Broken references; PostgreSQL migration stopped before preservation"
                )
    if connection.scalar(
        text(
            "SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace "
            "AND NOT convalidated"
        )
    ):
        raise RuntimeError("Unvalidated constraints; migration stopped before preservation")
    exported = connection.scalar(text("SELECT pg_export_snapshot()"))
    settings = get_settings()
    if "attachments" in tables:
        check_ready_documents(
            connection.execute(text("SELECT * FROM attachments")).mappings(),
            settings.private_files_path,
        )
    root = Path(
        os.environ.get(
            "AGROCONTROL_PRESERVATION_DIR",
            str(settings.private_files_path.parent / "migration-snapshots-postgresql"),
        )
    )
    if not root.is_absolute():
        raise RuntimeError("Preservation directory must be absolute")
    source = settings.private_files_path.resolve()
    if root.resolve() == source or source in root.resolve().parents:
        raise RuntimeError("Preservation directory must be outside the attachment source")
    directory = root / str(uuid4())
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    target = directory / "database.dump"
    url = make_url(settings.database_url)
    environment = os.environ.copy()
    environment.update(
        {
            "PGHOST": url.host or "localhost",
            "PGPORT": str(url.port or 5432),
            "PGDATABASE": url.database or "",
            "PGUSER": url.username or "",
            "PGPASSWORD": url.password or "",
        }
    )
    for option in ("sslmode", "sslrootcert", "sslcert", "sslkey"):
        if option in url.query:
            environment[f"PG{option.upper()}"] = url.query[option]
    result = subprocess.run(
        [
            dump,
            "--format=custom",
            "--snapshot",
            exported,
            "--file",
            str(target),
        ],
        env=environment,
        capture_output=True,
        check=False,
        timeout=600,
    )
    if result.returncode:
        raise RuntimeError("pg_dump failed; migration stopped, partial copy retained for review")
    listed = subprocess.run(
        [restore, "--list", str(target)], capture_output=True, check=False, timeout=60
    )
    if listed.returncode:
        raise RuntimeError("PostgreSQL dump catalog verification failed; migration stopped")
    with target.open("r+b") as output:
        os.fsync(output.fileno())
    manifest = {
        "format_version": 1,
        "kind": "postgresql_pre_migration",
        "external_backup": "pending",
        "snapshot_id": directory.name,
        "created_at_utc": utc_now(),
        "schema_revisions": list(current),
        "database": {
            "path": target.name,
            "size": target.stat().st_size,
            "sha256": file_hash(target),
        },
        "documents": copy_documents(settings.private_files_path, directory),
    }
    seal_manifest(directory, manifest)
    verify_snapshot(directory)

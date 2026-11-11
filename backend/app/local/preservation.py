"""Local safety copies before schema changes. Never an external backup claim."""

import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from app.local.files import verify_file


def utc_now():
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def disk_path(path):
    path = Path(path)
    if os.name == "nt":
        value = str(path.absolute())
        if not value.startswith("\\\\?\\"):
            value = "\\\\?\\UNC\\" + value[2:] if value.startswith("\\\\") else "\\\\?\\" + value
        return Path(value)
    return path


def check_sqlite(connection):
    results = [row[0] for row in connection.execute("PRAGMA integrity_check")]
    if results != ["ok"] or connection.execute("PRAGMA foreign_key_check").fetchone():
        raise RuntimeError("Integrity check failed; no schema changes were applied")


def check_ready_documents(rows, root, *, staged=False):
    for row in rows:
        if not (bool(row["ready"]) if staged else row["status"] == "ready"):
            continue
        identifier = str(UUID(str(row["id"])))
        if staged:
            relative = Path("staged") / identifier
        else:
            organization = str(UUID(str(row["organization_id"])))
            order = str(UUID(str(row["order_id"])))
            relative = Path(organization) / order / identifier
        path = root / relative
        if (
            path.is_symlink()
            or root.resolve() not in path.resolve().parents
            or not verify_file(disk_path(path), row["size_bytes"], row["sha256"])
        ):
            raise RuntimeError(
                "A confirmed document is missing or corrupt; migration stopped, originals retained"
            )


def file_hash(path):
    with disk_path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def copy_exclusive(source, target):
    source, target = disk_path(source), disk_path(target)
    if source.is_symlink() or not source.is_file():
        raise RuntimeError("Unsafe file in preservation source")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        shutil.copyfileobj(incoming, outgoing)
        outgoing.flush()
        os.fsync(outgoing.fileno())
    if file_hash(source) != file_hash(target):
        raise RuntimeError("Preservation copy verification failed")


def copy_documents(source, destination):
    source, destination = disk_path(source), disk_path(destination)
    if (
        source.is_symlink()
        or source.resolve() == destination.resolve()
        or source.resolve() in destination.resolve().parents
    ):
        raise RuntimeError("Preservation destination must be outside the document source")
    files = []
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise RuntimeError("Symlinks are not accepted in document preservation")
        if path.is_file():
            relative = path.relative_to(source)
            target = destination / "attachments" / relative
            copy_exclusive(path, target)
            files.append(
                {
                    "path": f"attachments/{relative.as_posix()}",
                    "size": target.stat().st_size,
                    "sha256": file_hash(target),
                }
            )
    return files


def seal_manifest(directory, manifest):
    directory = disk_path(directory)
    with (directory / "manifest.json").open("x", encoding="utf-8") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())
    if os.name != "nt":
        paths = [path for path in directory.rglob("*") if path.is_dir()]
        paths = sorted(paths, key=lambda path: len(path.parts), reverse=True)
        for path in [*paths, directory, directory.parent, directory.parent.parent]:
            descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)


def preserve_sqlite(database, attachments, revisions):
    # Caller holds BEGIN IMMEDIATE for the entire copy AND subsequent migration.
    directory = database.parent / "migration-snapshots" / str(uuid4())
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    target = directory / database.name
    with closing(sqlite3.connect(database)) as source, closing(sqlite3.connect(target)) as copied:
        source.backup(copied)
        check_sqlite(copied)
    with target.open("r+b") as output:
        os.fsync(output.fileno())
    manifest = {
        "format_version": 1,
        "kind": "local_pre_migration",
        "external_backup": "pending",
        "snapshot_id": directory.name,
        "created_at_utc": utc_now(),
        "schema_revisions": revisions,
        "sqlite_version": sqlite3.sqlite_version,
        "coverage": "committed_database_and_existing_documents",
        "pending_uploads_may_need_originals": True,
        "database": {
            "path": target.name,
            "size": target.stat().st_size,
            "sha256": file_hash(target),
        },
        "documents": copy_documents(attachments, directory),
    }
    seal_manifest(directory, manifest)
    verify_snapshot(directory)
    return directory


def verify_snapshot(directory):
    directory = Path(directory).resolve()
    manifest = json.loads(disk_path(directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1:
        raise RuntimeError("Unknown preservation manifest version")
    for entry in [manifest["database"], *manifest["documents"]]:
        if Path(entry["path"]).is_absolute() or ".." in Path(entry["path"]).parts:
            raise RuntimeError("Unsafe preservation manifest path")
        target = directory / entry["path"]
        physical = disk_path(target)
        if (
            physical.is_symlink()
            or not physical.is_file()
            or directory not in target.resolve().parents
            or physical.stat().st_size != entry["size"]
            or file_hash(target) != entry["sha256"]
        ):
            raise RuntimeError("Preservation snapshot is incomplete or corrupt")
    if manifest["database"]["path"].endswith(".sqlite3"):
        with closing(
            sqlite3.connect(
                f"{(directory / manifest['database']['path']).as_uri()}?mode=ro", uri=True
            )
        ) as copied:
            check_sqlite(copied)
    return manifest


def restore_sqlite_copy(directory, destination):
    """Restore only into a brand new directory; never replace an installation."""
    manifest = verify_snapshot(directory)
    if manifest["kind"] != "local_pre_migration":
        raise RuntimeError("This command restores SQLite preservation copies only")
    destination = Path(destination)
    if not destination.is_absolute():
        raise ValueError("An absolute, nonexistent restore destination is required")
    if Path(directory).resolve() in destination.resolve().parents:
        raise ValueError("Restore destination must be outside the preservation snapshot")
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    for entry in [manifest["database"], *manifest["documents"]]:
        copy_exclusive(Path(directory) / entry["path"], destination / entry["path"])
    return destination

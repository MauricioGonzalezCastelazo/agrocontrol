import sqlite3

from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL


def sqlite_engine(path):
    engine = create_engine(
        URL.create("sqlite", database=str(path)),
        connect_args={"check_same_thread": False, "timeout": 15},
        pool_pre_ping=True,
    )

    @event.listens_for(engine, "connect")
    def configure(connection, record):
        # Explicit BEGIN includes reads and DDL, avoiding sqlite3 legacy transaction mode.
        connection.isolation_level = None
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=15000")
        # 3.50.4 (the current Windows runtime) has the WAL-reset bug. Prefer durability.
        cursor.execute("PRAGMA synchronous=EXTRA")
        cursor.execute("PRAGMA fullfsync=ON")
        cursor.close()

    @event.listens_for(engine, "begin")
    def begin(connection):
        immediate = connection.get_execution_options().get("sqlite_write", False)
        connection.exec_driver_sql("BEGIN IMMEDIATE" if immediate else "BEGIN")

    return engine


def runtime_info():
    return {
        "sqlite_version": sqlite3.sqlite_version,
        "journal_mode": "delete",
        "synchronous": "extra",
    }

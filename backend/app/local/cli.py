import argparse
import json
import os
import secrets
from pathlib import Path

import uvicorn

from app.local.application import local_application
from app.local.paths import data_directory
from app.local.preservation import restore_sqlite_copy, verify_snapshot
from app.local.runtime import LocalRuntime


def main():
    parser = argparse.ArgumentParser(description="AgroControl local SQLite")
    parser.add_argument(
        "command",
        choices=["serve", "migrate", "verify-snapshot", "restore-copy"],
        nargs="?",
        default="serve",
    )
    parser.add_argument("snapshot", nargs="?")
    parser.add_argument("destination", nargs="?")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--origin", default="http://127.0.0.1:5174")
    args = parser.parse_args()
    if args.command in ("verify-snapshot", "restore-copy"):
        if not args.snapshot:
            parser.error("Provide the preservation directory")
        manifest = verify_snapshot(Path(args.snapshot))
        if args.command == "restore-copy":
            if not args.destination:
                parser.error("Provide an absolute, nonexistent restore destination")
            restore_sqlite_copy(Path(args.snapshot), Path(args.destination))
        print(
            json.dumps(
                {
                    "verified": True,
                    "snapshot_id": manifest["snapshot_id"],
                    "external_backup": "pending",
                }
            )
        )
        return
    runtime = LocalRuntime(
        data_directory(),
        args.origin,
        os.environ.pop("AGROCONTROL_BOOTSTRAP", "") or secrets.token_urlsafe(32),
    )
    if args.command == "migrate":
        try:
            runtime.initialize()
        finally:
            runtime.close()
    else:
        uvicorn.run(local_application(runtime), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()

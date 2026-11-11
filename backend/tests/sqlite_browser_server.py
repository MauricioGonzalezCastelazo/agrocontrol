"""Isolated SQLite browser harness. Never imported by the production runtime."""

import os
import secrets
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn
from fastapi.responses import JSONResponse

from app.local.application import local_application
from app.local.runtime import LocalRuntime


def main():
    if os.environ.get("AGROCONTROL_SQLITE_BROWSER_TEST") != "1":
        raise RuntimeError("Explicit SQLite browser-test invocation required")
    root = Path(__file__).resolve().parents[2] / ".local"
    root.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix="sqlite-browser-", dir=root) as directory:
        runtime = LocalRuntime(Path(directory), "http://127.0.0.1:5177", secrets.token_urlsafe(32))
        app = local_application(runtime)

        @app.middleware("http")
        async def test_launch(request, call_next):
            if (
                request.url.path == "/__test__/launch"
                and request.headers.get("x-test-harness") == "isolated-sqlite-browser-only"
            ):
                token = secrets.token_urlsafe(32)
                with runtime.lock:
                    runtime.bootstrap = token
                    runtime.bootstrap_expires = time.monotonic() + 60
                return JSONResponse({"token": token})
            return await call_next(request)

        uvicorn.run(app, host="127.0.0.1", port=8102, access_log=False)


if __name__ == "__main__":
    main()

import secrets
from contextlib import asynccontextmanager

from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.local.runtime import LocalRuntime
from app.main import create_app
from app.persistence.database import get_db


def local_application(runtime: LocalRuntime):
    @asynccontextmanager
    async def lifespan(application):
        runtime.initialize()
        try:
            yield
        finally:
            runtime.close()

    app = create_app()
    app.router.lifespan_context = lifespan
    app.state.local_runtime = runtime
    app.state.private_files_path = runtime.files

    def local_db(request: Request):
        with Session(runtime.engine) as db:
            # Reserve the write transaction BEFORE reading balances or versions. Unlike PG,
            # SQLite does not provide SELECT FOR UPDATE. Exceptions always roll back on close.
            db.connection(execution_options={"sqlite_write": request.method not in ("GET", "HEAD")})
            try:
                yield db
            except BaseException:
                db.rollback()
                raise

    app.dependency_overrides[get_db] = local_db

    from app.local.routes import router

    app.include_router(router)

    @app.middleware("http")
    async def authorize(request, call_next):
        peer = request.client.host if request.client else ""
        host = request.headers.get("host", "").split(":")[0]
        if peer != "127.0.0.1" or host != "127.0.0.1":
            return JSONResponse({"detail": "Acceso local no autorizado"}, status_code=403)
        origin = request.headers.get("origin")
        if request.url.path == "/health/live" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        if origin != runtime.origin:
            return JSONResponse({"detail": "Origen local no autorizado"}, status_code=403)
        if request.url.path == "/api/v1/local/bootstrap" and request.method == "POST":
            return await call_next(request)
        csrf = runtime.session(request.cookies.get("agrocontrol_local"))
        if csrf is None:
            return JSONResponse(
                {"detail": "Abre AgroControl desde python main.py."}, status_code=401
            )
        if request.url.path != "/api/v1/local/session" and not secrets.compare_digest(
            request.headers.get("x-local-csrf", ""), csrf
        ):
            return JSONResponse({"detail": "Autorización local requerida"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    # The outer CORS layer answers preflight; authorization above still guards all data.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[runtime.origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Organization-ID", "X-Local-CSRF", "Idempotency-Key"],
        expose_headers=["X-Operation-ID", "X-Operation-Outcome", "X-Operation-Replayed"],
    )
    return app

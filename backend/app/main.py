from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.business import router as business
from app.api.files import router as files
from app.api.payments import router as payments
from app.api.routes import api, health
from app.core.config import get_settings


def create_app() -> FastAPI:
    application = FastAPI(title="AgroControl API", version="0.1.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Organization-ID", "Idempotency-Key"],
    )

    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Request-ID"] = str(uuid4())
        return response

    @application.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        return JSONResponse(
            status_code=503, content={"detail": "Datos no disponibles temporalmente"}
        )

    application.include_router(health)
    application.include_router(api)
    application.include_router(business)
    application.include_router(files)
    application.include_router(payments)
    return application


app = create_app()

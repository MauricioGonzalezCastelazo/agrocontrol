from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, current_principal
from app.persistence.database import get_db

health = APIRouter(prefix="/health", tags=["health"])
api = APIRouter(prefix="/api/v1", tags=["session"])


@health.get("/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@health.get("/ready")
def ready(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1 FROM organizations LIMIT 1"))
    except SQLAlchemyError:
        raise HTTPException(503, "Base de datos no disponible o sin migrar") from None
    return {"status": "ready"}


class SessionResponse(BaseModel):
    user_id: UUID
    organization_id: UUID
    role: str


@api.get("/session", response_model=SessionResponse)
def session(principal: Annotated[Principal, Depends(current_principal)]) -> SessionResponse:
    return SessionResponse(
        user_id=principal.user_id, organization_id=principal.organization_id, role=principal.role
    )

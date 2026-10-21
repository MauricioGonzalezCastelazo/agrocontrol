from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.provider import (
    IdentityProvider,
    IdentityUnavailable,
    InvalidIdentity,
    SupabaseIdentityProvider,
)
from app.core.config import get_settings
from app.persistence.database import get_db
from app.persistence.models import Membership

bearer = HTTPBearer(auto_error=False)


@lru_cache
def get_identity_provider() -> IdentityProvider:
    return SupabaseIdentityProvider(get_settings())


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    organization_id: UUID
    role: str


def current_principal(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    organization_id: Annotated[UUID, Header(alias="X-Organization-ID")],
    provider: Annotated[IdentityProvider, Depends(get_identity_provider)],
    db: Annotated[Session, Depends(get_db)],
) -> Principal:
    if credentials is None:
        raise HTTPException(401, "Sesión requerida", headers={"WWW-Authenticate": "Bearer"})
    try:
        identity = provider.verify(credentials.credentials)
    except InvalidIdentity:
        raise HTTPException(
            401, "Sesión no válida", headers={"WWW-Authenticate": "Bearer"}
        ) from None
    except IdentityUnavailable:
        raise HTTPException(503, "Servicio de identidad no disponible") from None
    membership = db.get(Membership, (organization_id, identity.subject))
    if membership is None or not membership.active:
        raise HTTPException(403, "Acceso no autorizado")
    return Principal(identity.subject, organization_id, membership.role)


def administrator(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
    if principal.role != "administrator":
        raise HTTPException(403, "Acceso no autorizado")
    return principal

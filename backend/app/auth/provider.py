from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import jwt
from jwt import PyJWKClient

from app.core.config import Settings


class InvalidIdentity(Exception):
    pass


class IdentityUnavailable(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    subject: UUID


class IdentityProvider(Protocol):
    def verify(self, token: str) -> Identity: ...


class SupabaseIdentityProvider:
    """Only asymmetric, issuer-bound JWTs; permissions always come from our database."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.jwks = (
            PyJWKClient(settings.auth_jwks_url, cache_keys=False, lifespan=300, timeout=5)
            if settings.auth_jwks_url.startswith("https://")
            else None
        )

    def verify(self, token: str) -> Identity:
        if not self.jwks or not self.settings.auth_issuer.startswith("https://"):
            raise IdentityUnavailable
        try:
            key = self.jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256", "ES256"],
                audience=self.settings.auth_audience,
                issuer=self.settings.auth_issuer,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
            return Identity(subject=UUID(claims["sub"]))
        except jwt.PyJWKClientConnectionError as exc:
            raise IdentityUnavailable from exc
        except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
            raise InvalidIdentity from exc

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.provider import IdentityUnavailable, InvalidIdentity, SupabaseIdentityProvider
from app.core.config import Settings

SUBJECT = "20000000-0000-4000-8000-000000000001"
ISSUER = "https://identity.example.test/auth/v1"


@pytest.fixture(scope="module")
def private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def provider(private_key):
    provider = SupabaseIdentityProvider(
        Settings(auth_issuer=ISSUER, auth_jwks_url=f"{ISSUER}/.well-known/jwks.json")
    )
    # Replace key transport only; all JWT cryptographic validation remains real.
    provider.jwks = SimpleNamespace(
        get_signing_key_from_jwt=lambda token: SimpleNamespace(key=private_key.public_key())
    )
    return provider


def token(private_key, **overrides):
    now = datetime.now(UTC)
    claims = {
        "sub": SUBJECT,
        "iss": ISSUER,
        "aud": "authenticated",
        "iat": now,
        "exp": now + timedelta(minutes=5),
    }
    claims.update(overrides)
    return jwt.encode(claims, private_key, algorithm="RS256")


def test_valid_asymmetric_jwt(provider, private_key):
    assert provider.verify(token(private_key)).subject == UUID(SUBJECT)


@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://attacker.example.test"},
        {"aud": "other-service"},
        {"exp": datetime.now(UTC) - timedelta(minutes=1)},
        {"iat": datetime.now(UTC) + timedelta(minutes=10)},
        {"sub": "not-a-uuid"},
    ],
)
def test_invalid_claims_are_denied(provider, private_key, overrides):
    with pytest.raises(InvalidIdentity):
        provider.verify(token(private_key, **overrides))


def test_missing_expiration_is_denied(provider, private_key):
    claims = {"sub": SUBJECT, "iss": ISSUER, "aud": "authenticated", "iat": datetime.now(UTC)}
    with pytest.raises(InvalidIdentity):
        provider.verify(jwt.encode(claims, private_key, algorithm="RS256"))


def test_forged_signature_is_denied(provider):
    foreign_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(InvalidIdentity):
        provider.verify(token(foreign_key))


def test_symmetric_algorithm_is_not_allowed(provider):
    with pytest.raises(InvalidIdentity):
        provider.verify(
            jwt.encode({"sub": SUBJECT}, "synthetic-unit-test-key-of-32-bytes", algorithm="HS256")
        )


def test_unconfigured_identity_fails_closed():
    with pytest.raises(IdentityUnavailable):
        SupabaseIdentityProvider(Settings(auth_issuer="", auth_jwks_url="")).verify("anything")


def test_jwks_connection_failure_is_unavailable(provider):
    def unavailable(token):
        raise jwt.PyJWKClientConnectionError("unavailable")

    provider.jwks = SimpleNamespace(get_signing_key_from_jwt=unavailable)
    with pytest.raises(IdentityUnavailable):
        provider.verify("anything")

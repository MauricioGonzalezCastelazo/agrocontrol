from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT / ".env", ROOT / "backend" / ".env"), extra="ignore"
    )

    database_url: str = "postgresql+psycopg://agrocontrol@localhost:5432/agrocontrol"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:8080",
    ]
    auth_issuer: str = ""
    auth_jwks_url: str = ""
    auth_audience: str = "authenticated"
    private_files_path: Path = ROOT / ".local" / "private-files"
    max_attachment_bytes: int = 25 * 1024 * 1024
    max_order_attachment_bytes: int = 100 * 1024 * 1024
    max_attachments: int = 20

    @field_validator("private_files_path")
    @classmethod
    def absolute_storage(cls, value: Path):
        return value if value.is_absolute() else ROOT / value


@lru_cache
def get_settings() -> Settings:
    return Settings()

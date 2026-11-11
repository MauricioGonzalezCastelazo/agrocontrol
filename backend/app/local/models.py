from sqlalchemy import CheckConstraint, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class LocalBase(DeclarativeBase):
    pass


class Installation(LocalBase):
    __tablename__ = "local_installation"
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[str] = mapped_column(String(36))
    user_id: Mapped[str] = mapped_column(String(36))


class CaptureStore(LocalBase):
    """Versioned recovery queue. Business records remain in normalized shared tables."""

    __tablename__ = "local_capture_store"
    __table_args__ = (CheckConstraint("revision >= 0", name="revision_nonnegative"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[str] = mapped_column(Text)


class LocalBlob(LocalBase):
    __tablename__ = "local_blobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    ready: Mapped[int] = mapped_column(Integer, default=0)


class StorageIdentity(LocalBase):
    __tablename__ = "local_storage_identity"
    id: Mapped[int] = mapped_column(primary_key=True)
    installation_id: Mapped[str] = mapped_column(String(36))
    metadata_created_at_utc: Mapped[str] = mapped_column(String(32))
    manifest_format_version: Mapped[int] = mapped_column(Integer)
    external_backup_state: Mapped[str] = mapped_column(String(16))


class DocumentAction(LocalBase):
    __tablename__ = "local_document_actions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    operation_id: Mapped[str] = mapped_column(String(36))
    source_path: Mapped[str] = mapped_column(Text)
    destination_path: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(Text)
    created_at_utc: Mapped[str] = mapped_column(String(32))

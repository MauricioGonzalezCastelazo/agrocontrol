from datetime import datetime
from decimal import Decimal, localcontext
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Integer, MetaData, Numeric, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class ExactMoney(TypeDecorator):
    """PostgreSQL NUMERIC; text in SQLite test databases to avoid float conversion."""

    impl = Numeric(32, 8)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(String(40) if dialect.name == "sqlite" else Numeric(32, 8))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        with localcontext() as context:
            context.prec = 80
            number = Decimal(value).quantize(Decimal("0.00000001"))
        return format(number, ".8f") if dialect.name == "sqlite" else number

    def process_result_value(self, value, dialect):
        return Decimal(value) if value is not None else None


class Record:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

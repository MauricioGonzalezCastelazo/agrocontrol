from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.persistence.base import Base, ExactMoney, Record


class Organization(Record, Base):
    __tablename__ = "organizations"
    __table_args__ = (CheckConstraint("version > 0", name="version_positive"),)
    name: Mapped[str] = mapped_column(String(200))


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (CheckConstraint("role IN ('administrator', 'operator')", name="role"),)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(primary_key=True)
    role: Mapped[str] = mapped_column(String(24))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class Customer(Record, Base):
    __tablename__ = "customers"
    __table_args__ = (
        UniqueConstraint("id", "organization_id"),
        CheckConstraint("length(trim(name)) > 0", name="name_not_blank"),
        CheckConstraint("version > 0", name="version_positive"),
        Index("ix_customers_organization_name", "organization_id", "name"),
    )
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text)
    creation_hash: Mapped[str | None] = mapped_column(String(64))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Order(Record, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("id", "organization_id"),
        Index(
            "uq_orders_org_product_active_remission",
            "organization_id",
            "product_type",
            "remission_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
        CheckConstraint(
            "remission_number IS NULL OR remission_number > 0", name="remission_positive"
        ),
        ForeignKeyConstraint(
            ["customer_id", "organization_id"], ["customers.id", "customers.organization_id"]
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        CheckConstraint("product_type IN ('carrot', 'potato')", name="supported_product"),
        CheckConstraint("total_amount >= 0", name="total_nonnegative"),
        CheckConstraint("version > 0", name="version_positive"),
        Index("ix_orders_organization_created", "organization_id", "created_at"),
    )
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id"))
    customer_id: Mapped[UUID]
    product_type: Mapped[str] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    total_amount: Mapped[Decimal] = mapped_column(ExactMoney())
    remission_number: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[UUID]
    order_date: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    currency: Mapped[str] = mapped_column(String(3), server_default="MXN", default="MXN")
    creation_hash: Mapped[str | None] = mapped_column(String(64))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_update_hash: Mapped[str | None] = mapped_column(String(64))
    updated_by: Mapped[UUID | None]


class CarrotDetails(Base):
    __tablename__ = "order_carrot_details"
    __table_args__ = (
        ForeignKeyConstraint(
            ["order_id", "organization_id"], ["orders.id", "orders.organization_id"]
        ),
        CheckConstraint("hectares > 0", name="hectares_positive"),
        CheckConstraint("unit_price >= 0", name="price_nonnegative"),
    )
    order_id: Mapped[UUID] = mapped_column(primary_key=True)
    organization_id: Mapped[UUID]
    hectares: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    price_unit: Mapped[str | None] = mapped_column(String(80))


class PotatoDetails(Base):
    __tablename__ = "order_potato_details"
    calculation_version: Mapped[str] = mapped_column(
        String(24), default="potato-v2", server_default="potato-v2"
    )
    __table_args__ = (
        UniqueConstraint("order_id", "organization_id"),
        ForeignKeyConstraint(
            ["order_id", "organization_id"], ["orders.id", "orders.organization_id"]
        ),
        CheckConstraint("gross_weight > tare_weight AND tare_weight >= 0", name="valid_weights"),
        CheckConstraint(
            "shrinkage_override IS NULL OR shrinkage_override >= 0", name="valid_override"
        ),
        CheckConstraint(
            "additional_shrinkage >= 0 AND additional_shrinkage <= gross_weight - tare_weight",
            name="valid_shrinkage",
        ),
    )
    order_id: Mapped[UUID] = mapped_column(primary_key=True)
    organization_id: Mapped[UUID]
    gross_weight: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    tare_weight: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    additional_shrinkage: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    shrinkage_override: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))


class PotatoGradeLine(Base):
    __tablename__ = "order_potato_lines"
    __table_args__ = (
        ForeignKeyConstraint(
            ["order_id", "organization_id"],
            ["order_potato_details.order_id", "order_potato_details.organization_id"],
        ),
        CheckConstraint("grade_code IN ('1RA', '2DA', '3RA', '4TA')", name="grade_code"),
        CheckConstraint("quantity >= 0 AND unit_price >= 0", name="nonnegative"),
    )
    order_id: Mapped[UUID] = mapped_column(primary_key=True)
    grade_code: Mapped[str] = mapped_column(String(3), primary_key=True)
    organization_id: Mapped[UUID]
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4))


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    actor_id: Mapped[UUID]
    action: Mapped[str] = mapped_column(String(80))
    record_id: Mapped[UUID]
    # No free-text payloads, credentials, descriptions, or tokens in audit records.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["order_id", "organization_id"], ["orders.id", "orders.organization_id"]
        ),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("status IN ('pending', 'ready')", name="status"),
        Index("ix_attachments_order", "organization_id", "order_id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True)
    order_id: Mapped[UUID]
    organization_id: Mapped[UUID]
    filename: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Payment(Record, Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("id", "organization_id"),
        ForeignKeyConstraint(
            ["customer_id", "organization_id"], ["customers.id", "customers.organization_id"]
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
        CheckConstraint("CAST(amount AS NUMERIC) > 0", name="amount_positive"),
        CheckConstraint("version > 0", name="version_positive"),
        Index("ix_payments_org_customer", "organization_id", "customer_id"),
    )
    organization_id: Mapped[UUID]
    customer_id: Mapped[UUID]
    amount: Mapped[Decimal] = mapped_column(ExactMoney())
    payment_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID]
    creation_hash: Mapped[str] = mapped_column(String(64))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[UUID | None]
    void_reason: Mapped[str | None] = mapped_column(String(1000))


class PaymentApplication(Record, Base):
    __tablename__ = "payment_applications"
    __table_args__ = (
        UniqueConstraint("id", "organization_id"),
        ForeignKeyConstraint(
            ["payment_id", "organization_id"], ["payments.id", "payments.organization_id"]
        ),
        ForeignKeyConstraint(
            ["organization_id", "created_by"],
            ["memberships.organization_id", "memberships.user_id"],
        ),
    )
    organization_id: Mapped[UUID]
    payment_id: Mapped[UUID]
    application_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID]
    creation_hash: Mapped[str] = mapped_column(String(64))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[UUID | None]
    void_reason: Mapped[str | None] = mapped_column(String(1000))


class PaymentAllocation(Base):
    __tablename__ = "payment_allocations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["application_id", "organization_id"],
            ["payment_applications.id", "payment_applications.organization_id"],
        ),
        ForeignKeyConstraint(
            ["order_id", "organization_id"], ["orders.id", "orders.organization_id"]
        ),
        CheckConstraint("CAST(amount AS NUMERIC) > 0", name="amount_positive"),
        Index("ix_payment_allocations_order", "organization_id", "order_id"),
    )
    application_id: Mapped[UUID] = mapped_column(primary_key=True)
    order_id: Mapped[UUID] = mapped_column(primary_key=True)
    organization_id: Mapped[UUID]
    amount: Mapped[Decimal] = mapped_column(ExactMoney())

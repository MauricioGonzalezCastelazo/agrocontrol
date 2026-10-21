"""Product-scoped remissions, customer receipts, advances and order allocations."""

import sqlalchemy as sa
from alembic import op

revision = "0007_remissions_payments"
down_revision = "0006_editable_shrinkage"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("orders", sa.Column("remission_number", sa.Integer(), nullable=True))
    op.create_unique_constraint(
        "uq_orders_org_product_remission",
        "orders",
        ["organization_id", "product_type", "remission_number"],
    )
    op.create_check_constraint(
        op.f("ck_orders_remission_positive"),
        "orders",
        "remission_number IS NULL OR remission_number > 0",
    )
    for name, extra in [
        (
            "payments",
            [
                sa.Column("customer_id", sa.Uuid(), nullable=False),
                sa.Column("amount", sa.Numeric(32, 8), nullable=False),
                sa.Column("payment_date", sa.Date(), nullable=False),
            ],
        ),
        (
            "payment_applications",
            [
                sa.Column("payment_id", sa.Uuid(), nullable=False),
                sa.Column("application_date", sa.Date(), nullable=False),
            ],
        ),
    ]:
        reference = "customer_id" if name == "payments" else "payment_id"
        parent = "customers" if name == "payments" else "payments"
        op.create_table(
            name,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            *extra,
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_by", sa.Uuid(), nullable=False),
            sa.Column("creation_hash", sa.String(64), nullable=False),
            sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("voided_by", sa.Uuid(), nullable=True),
            sa.Column("void_reason", sa.String(1000), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.PrimaryKeyConstraint("id", name=f"pk_{name}"),
            sa.UniqueConstraint("id", "organization_id", name=f"uq_{name}_id"),
            sa.ForeignKeyConstraint(
                [reference, "organization_id"],
                [f"{parent}.id", f"{parent}.organization_id"],
                name=f"fk_{name}_{reference}_{parent}",
            ),
            sa.ForeignKeyConstraint(
                ["organization_id", "created_by"],
                ["memberships.organization_id", "memberships.user_id"],
                name=f"fk_{name}_organization_id_memberships",
            ),
        )
    op.create_check_constraint(
        op.f("ck_payments_amount_positive"), "payments", "CAST(amount AS NUMERIC) > 0"
    )
    op.create_check_constraint(op.f("ck_payments_version_positive"), "payments", "version > 0")
    op.create_index("ix_payments_org_customer", "payments", ["organization_id", "customer_id"])
    op.create_table(
        "payment_allocations",
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(32, 8), nullable=False),
        sa.PrimaryKeyConstraint("application_id", "order_id", name="pk_payment_allocations"),
        sa.ForeignKeyConstraint(
            ["application_id", "organization_id"],
            ["payment_applications.id", "payment_applications.organization_id"],
            name="fk_payment_allocations_application_id_payment_applications",
        ),
        sa.ForeignKeyConstraint(
            ["order_id", "organization_id"],
            ["orders.id", "orders.organization_id"],
            name="fk_payment_allocations_order_id_orders",
        ),
        sa.CheckConstraint(
            "CAST(amount AS NUMERIC) > 0", name=op.f("ck_payment_allocations_amount_positive")
        ),
    )
    op.create_index(
        "ix_payment_allocations_order", "payment_allocations", ["organization_id", "order_id"]
    )


def downgrade():
    if not op.get_context().as_sql and (
        op.get_bind().scalar(sa.text("SELECT count(*) FROM payments"))
        or op.get_bind().scalar(
            sa.text("SELECT count(*) FROM orders WHERE remission_number IS NOT NULL")
        )
    ):
        raise RuntimeError(
            "No se puede revertir: existen cobros o remisiones. Respalda y migra sus datos."
        )
    op.drop_table("payment_allocations")
    op.drop_table("payment_applications")
    op.drop_table("payments")
    op.drop_constraint(op.f("ck_orders_remission_positive"), "orders", type_="check")
    op.drop_constraint("uq_orders_org_product_remission", "orders", type_="unique")
    op.drop_column("orders", "remission_number")

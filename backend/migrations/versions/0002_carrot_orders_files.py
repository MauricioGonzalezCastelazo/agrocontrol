"""Business date, MXN, creation fingerprints and private attachment manifests."""

import sqlalchemy as sa
from alembic import op

revision = "0002_orders_files"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("customers", sa.Column("creation_hash", sa.String(64), nullable=True))
    op.add_column("orders", sa.Column("order_date", sa.Date(), nullable=True))
    # Preserve historical dates in the Mexican business timezone.
    op.execute(
        "UPDATE orders SET order_date = (created_at AT TIME ZONE 'America/Mexico_City')::date"
    )
    op.alter_column("orders", "order_date", nullable=False, server_default=sa.text("CURRENT_DATE"))
    op.add_column(
        "orders", sa.Column("currency", sa.String(3), nullable=False, server_default="MXN")
    )
    op.add_column("orders", sa.Column("creation_hash", sa.String(64), nullable=True))
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(200), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id", name="pk_attachments"),
        sa.CheckConstraint("size_bytes > 0", name=op.f("ck_attachments_size_positive")),
        sa.CheckConstraint("status IN ('pending', 'ready')", name=op.f("ck_attachments_status")),
        sa.ForeignKeyConstraint(
            ["order_id", "organization_id"],
            ["orders.id", "orders.organization_id"],
            name="fk_attachments_order_id_orders",
        ),
    )
    op.create_index("ix_attachments_order", "attachments", ["organization_id", "order_id"])


def downgrade():
    op.drop_index("ix_attachments_order", table_name="attachments")
    op.drop_table("attachments")
    op.drop_column("orders", "creation_hash")
    op.drop_column("orders", "currency")
    op.drop_column("orders", "order_date")
    op.drop_column("customers", "creation_hash")

"""Logical deletion and idempotent order updates."""

import sqlalchemy as sa
from alembic import op

revision = "0003_edit_delete"
down_revision = "0002_orders_files"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("customers", "orders", "attachments"):
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("last_update_hash", sa.String(64), nullable=True))


def downgrade():
    op.drop_column("orders", "last_update_hash")
    for table in ("attachments", "orders", "customers"):
        op.drop_column(table, "deleted_at")

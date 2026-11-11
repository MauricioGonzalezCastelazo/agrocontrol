"""Append-only versioned audit and durable operation receipts; preserve v1 events."""

import sqlalchemy as sa
from alembic import op

revision = "local_0003"
down_revision = "local_0002"
branch_labels = None
depends_on = None


def upgrade():
    for column in [
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("operation_id", sa.Uuid(), nullable=True),
        sa.Column("occurred_at_utc", sa.String(32), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("values_before", sa.Text(), nullable=True),
        sa.Column("values_after", sa.Text(), nullable=True),
    ]:
        op.add_column("audit_events", column)
    op.create_table(
        "operation_receipts",
        sa.Column(
            "organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), primary_key=True
        ),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_json", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("created_at_utc", sa.String(32), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
    )
    for action in ("UPDATE", "DELETE"):
        op.execute(
            f"CREATE TRIGGER operation_receipts_no_{action.lower()} BEFORE {action} "
            "ON operation_receipts BEGIN SELECT "
            "RAISE(ABORT, 'Operation receipts are immutable'); END"
        )


def downgrade():
    raise RuntimeError("No automatic downgrade of preserved audit/operation history")

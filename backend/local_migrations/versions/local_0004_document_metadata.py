"""Local preservation identity and append-only document reconciliation history."""

import sqlalchemy as sa
from alembic import op

revision = "local_0004"
down_revision = "local_0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "local_storage_identity",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("installation_id", sa.String(36), nullable=False),
        sa.Column("metadata_created_at_utc", sa.String(32), nullable=False),
        sa.Column("manifest_format_version", sa.Integer(), nullable=False),
        sa.Column("external_backup_state", sa.String(16), nullable=False),
    )
    op.create_table(
        "local_document_actions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("operation_id", sa.String(36), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("destination_path", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at_utc", sa.String(32), nullable=False),
    )
    for table in ("local_storage_identity", "local_document_actions"):
        for action in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER {table}_no_{action.lower()} BEFORE {action} ON {table} "
                "BEGIN SELECT RAISE(ABORT, 'Preservation metadata is immutable'); END"
            )


def downgrade():
    raise RuntimeError("No automatic downgrade of preservation metadata")

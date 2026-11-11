"""Persistent staged documents; physical objects are retained when captures are removed."""

import sqlalchemy as sa
from alembic import op

revision = "local_0002"
down_revision = "local_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "local_blobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("filename", sa.String(200), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("ready", sa.Integer(), nullable=False),
        sa.CheckConstraint("size_bytes > 0 AND size_bytes <= 26214400", name="blob_size"),
        sa.CheckConstraint("ready IN (0,1)", name="blob_state"),
    )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM local_blobs")):
        raise RuntimeError("Refusing to discard staged document metadata")
    op.drop_table("local_blobs")

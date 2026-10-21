"""Preserve automatic or manually entered potato shrinkage independently of weight."""

import sqlalchemy as sa
from alembic import op

revision = "0006_editable_shrinkage"
down_revision = "0005_potato_formula"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "order_potato_details", sa.Column("shrinkage_override", sa.Numeric(14, 4), nullable=True)
    )
    op.create_check_constraint(
        op.f("ck_order_potato_details_valid_override"),
        "order_potato_details",
        "shrinkage_override IS NULL OR shrinkage_override >= 0",
    )


def downgrade():
    if not op.get_context().as_sql and op.get_bind().scalar(
        sa.text("SELECT count(*) FROM order_potato_details WHERE shrinkage_override IS NOT NULL")
    ):
        raise RuntimeError(
            "No se puede revertir: existen pedidos con MERMA manual. Respalda sus datos."
        )
    op.drop_constraint(
        op.f("ck_order_potato_details_valid_override"), "order_potato_details", type_="check"
    )
    op.drop_column("order_potato_details", "shrinkage_override")

"""Version potato calculations without rewriting historical amounts."""

import sqlalchemy as sa
from alembic import op

revision = "0005_potato_formula"
down_revision = "0004_potato"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "order_potato_details",
        sa.Column("calculation_version", sa.String(24), nullable=False, server_default="potato-v1"),
    )
    op.alter_column("order_potato_details", "calculation_version", server_default="potato-v2")


def downgrade():
    if not op.get_context().as_sql and op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM order_potato_details WHERE calculation_version != 'potato-v1'"
        )
    ):
        raise RuntimeError(
            "No se puede revertir: existen pedidos de papa con el cálculo nuevo. "
            "Respáldalos y migra sus datos explícitamente."
        )
    op.drop_column("order_potato_details", "calculation_version")

"""Reserve remission numbers only for orders that have not been deleted."""

import sqlalchemy as sa
from alembic import op

revision = "0008_reusable_remissions"
down_revision = "0007_remissions_payments"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("uq_orders_org_product_remission", "orders", type_="unique")
    op.create_index(
        "uq_orders_org_product_active_remission",
        "orders",
        ["organization_id", "product_type", "remission_number"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade():
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM orders WHERE remission_number IS NOT NULL "
            "GROUP BY organization_id, product_type, remission_number HAVING count(*) > 1)"
        )
    ):
        raise RuntimeError(
            "No se puede revertir: existen remisiones reutilizadas. "
            "Conserva esta versión para mantener el historial sin pérdida de datos."
        )
    op.drop_index("uq_orders_org_product_active_remission", table_name="orders")
    op.create_unique_constraint(
        "uq_orders_org_product_remission",
        "orders",
        ["organization_id", "product_type", "remission_number"],
    )

"""Structured potato weighings and grade lines; preserve carrot records."""

import sqlalchemy as sa
from alembic import op

revision = "0004_potato"
down_revision = "0003_edit_delete"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(op.f("ck_orders_supported_product"), "orders", type_="check")
    op.create_check_constraint(
        op.f("ck_orders_supported_product"), "orders", "product_type IN ('carrot', 'potato')"
    )
    op.add_column("orders", sa.Column("updated_by", sa.Uuid(), nullable=True))
    op.create_table(
        "order_potato_details",
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("gross_weight", sa.Numeric(14, 4), nullable=False),
        sa.Column("tare_weight", sa.Numeric(14, 4), nullable=False),
        sa.Column("additional_shrinkage", sa.Numeric(14, 4), nullable=False),
        sa.PrimaryKeyConstraint("order_id", name="pk_order_potato_details"),
        sa.UniqueConstraint("order_id", "organization_id", name="uq_order_potato_details_order_id"),
        sa.ForeignKeyConstraint(
            ["order_id", "organization_id"],
            ["orders.id", "orders.organization_id"],
            name="fk_order_potato_details_order_id_orders",
        ),
        sa.CheckConstraint(
            "gross_weight > tare_weight AND tare_weight >= 0",
            name=op.f("ck_order_potato_details_valid_weights"),
        ),
        sa.CheckConstraint(
            "additional_shrinkage >= 0 AND additional_shrinkage <= gross_weight - tare_weight",
            name=op.f("ck_order_potato_details_valid_shrinkage"),
        ),
    )
    op.create_table(
        "order_potato_lines",
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("grade_code", sa.String(3), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(18, 4), nullable=False),
        sa.PrimaryKeyConstraint("order_id", "grade_code", name="pk_order_potato_lines"),
        sa.ForeignKeyConstraint(
            ["order_id", "organization_id"],
            ["order_potato_details.order_id", "order_potato_details.organization_id"],
            name="fk_order_potato_lines_order_id_order_potato_details",
        ),
        sa.CheckConstraint(
            "grade_code IN ('1RA', '2DA', '3RA', '4TA')",
            name=op.f("ck_order_potato_lines_grade_code"),
        ),
        sa.CheckConstraint(
            "quantity >= 0 AND unit_price >= 0", name=op.f("ck_order_potato_lines_nonnegative")
        ),
    )


def downgrade():
    # Refuse destructive downgrade if commercial potato orders exist, including tombstones.
    connection = op.get_bind()
    if not op.get_context().as_sql and connection.scalar(
        sa.text("SELECT count(*) FROM orders WHERE product_type = 'potato'")
    ):
        raise RuntimeError(
            "No se puede revertir: existen pedidos de papa. "
            "Respáldalos y migra sus datos explícitamente."
        )
    op.drop_table("order_potato_lines")
    op.drop_table("order_potato_details")
    op.drop_column("orders", "updated_by")
    op.drop_constraint(op.f("ck_orders_supported_product"), "orders", type_="check")
    op.create_check_constraint(
        op.f("ck_orders_supported_product"), "orders", "product_type = 'carrot'"
    )

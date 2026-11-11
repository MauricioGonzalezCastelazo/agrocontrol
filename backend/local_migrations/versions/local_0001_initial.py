"""Initial durable SQLite schema, equivalent to private schema 0008, plus local recovery state.

Frozen DDL: never generated from current application metadata at migration runtime.
"""

import sqlalchemy as sa
from alembic import op

revision = "local_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE organizations (
                name VARCHAR(200) NOT NULL,
                id CHAR(32) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                version INTEGER DEFAULT '1' NOT NULL,
                CONSTRAINT pk_organizations PRIMARY KEY (id),
                CONSTRAINT ck_organizations_version_positive CHECK (version > 0)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE audit_events (
                id CHAR(32) NOT NULL,
                organization_id CHAR(32) NOT NULL,
                actor_id CHAR(32) NOT NULL,
                action VARCHAR(80) NOT NULL,
                record_id CHAR(32) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT pk_audit_events PRIMARY KEY (id),
                CONSTRAINT fk_audit_events_organization_id_organizations FOREIGN
        KEY(organization_id) REFERENCES organizations (id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_audit_events_organization_id ON audit_events (organization_id)
        """
    )
    op.execute(
        """
        CREATE TABLE customers (
                organization_id CHAR(32) NOT NULL,
                name VARCHAR(200) NOT NULL,
                active BOOLEAN DEFAULT 'true' NOT NULL,
                notes TEXT,
                creation_hash VARCHAR(64),
                deleted_at DATETIME,
                id CHAR(32) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                version INTEGER DEFAULT '1' NOT NULL,
                CONSTRAINT pk_customers PRIMARY KEY (id),
                CONSTRAINT uq_customers_id UNIQUE (id, organization_id),
                CONSTRAINT ck_customers_name_not_blank CHECK (length(trim(name)) > 0),
                CONSTRAINT ck_customers_version_positive CHECK (version > 0),
                CONSTRAINT fk_customers_organization_id_organizations FOREIGN
        KEY(organization_id) REFERENCES organizations (id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_customers_organization_name ON customers (organization_id, name)
        """
    )
    op.execute(
        """
        CREATE TABLE memberships (
                organization_id CHAR(32) NOT NULL,
                user_id CHAR(32) NOT NULL,
                role VARCHAR(24) NOT NULL,
                active BOOLEAN DEFAULT 'true' NOT NULL,
                CONSTRAINT pk_memberships PRIMARY KEY (organization_id, user_id),
                CONSTRAINT ck_memberships_role CHECK (role IN ('administrator', 'operator')),
                CONSTRAINT fk_memberships_organization_id_organizations FOREIGN
        KEY(organization_id) REFERENCES organizations (id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE orders (
                organization_id CHAR(32) NOT NULL,
                customer_id CHAR(32) NOT NULL,
                product_type VARCHAR(32) NOT NULL,
                description TEXT,
                total_amount VARCHAR(40) NOT NULL,
                remission_number INTEGER,
                created_by CHAR(32) NOT NULL,
                order_date DATE DEFAULT CURRENT_DATE NOT NULL,
                currency VARCHAR(3) DEFAULT 'MXN' NOT NULL,
                creation_hash VARCHAR(64),
                deleted_at DATETIME,
                last_update_hash VARCHAR(64),
                updated_by CHAR(32),
                id CHAR(32) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                version INTEGER DEFAULT '1' NOT NULL,
                CONSTRAINT pk_orders PRIMARY KEY (id),
                CONSTRAINT uq_orders_id UNIQUE (id, organization_id),
                CONSTRAINT ck_orders_remission_positive CHECK (remission_number IS NULL OR
        remission_number > 0),
                CONSTRAINT fk_orders_customer_id_customers FOREIGN KEY(customer_id,
        organization_id) REFERENCES customers (id, organization_id),
                CONSTRAINT fk_orders_organization_id_memberships FOREIGN KEY(organization_id,
        created_by) REFERENCES memberships (organization_id, user_id),
                CONSTRAINT ck_orders_supported_product CHECK (product_type IN ('carrot',
        'potato')),
                CONSTRAINT ck_orders_total_nonnegative CHECK (total_amount >= 0),
                CONSTRAINT ck_orders_version_positive CHECK (version > 0),
                CONSTRAINT fk_orders_organization_id_organizations FOREIGN KEY(organization_id)
        REFERENCES organizations (id),
                CONSTRAINT ck_orders_total_amount_exact CHECK (typeof(total_amount) = 'text' AND
        length(total_amount) BETWEEN 10 AND 33 AND total_amount NOT GLOB '*[^0-9.]*' AND
        length(total_amount) - length(replace(total_amount, '.', '')) = 1 AND
        instr(total_amount, '.') = length(total_amount) - 8 AND (substr(total_amount, 1, 1) !=
        '0' OR instr(total_amount, '.') = 2))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_orders_organization_created ON orders (organization_id, created_at)
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_orders_org_product_active_remission ON orders (organization_id,
        product_type, remission_number) WHERE deleted_at IS NULL
        """
    )
    op.execute(
        """
        CREATE TABLE payments (
                organization_id CHAR(32) NOT NULL,
                customer_id CHAR(32) NOT NULL,
                amount VARCHAR(40) NOT NULL,
                payment_date DATE NOT NULL,
                description TEXT,
                created_by CHAR(32) NOT NULL,
                creation_hash VARCHAR(64) NOT NULL,
                voided_at DATETIME,
                voided_by CHAR(32),
                void_reason VARCHAR(1000),
                id CHAR(32) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                version INTEGER DEFAULT '1' NOT NULL,
                CONSTRAINT pk_payments PRIMARY KEY (id),
                CONSTRAINT uq_payments_id UNIQUE (id, organization_id),
                CONSTRAINT fk_payments_customer_id_customers FOREIGN KEY(customer_id,
        organization_id) REFERENCES customers (id, organization_id),
                CONSTRAINT fk_payments_organization_id_memberships FOREIGN KEY(organization_id,
        created_by) REFERENCES memberships (organization_id, user_id),
                CONSTRAINT ck_payments_amount_positive CHECK (CAST(amount AS NUMERIC) > 0),
                CONSTRAINT ck_payments_version_positive CHECK (version > 0),
                CONSTRAINT ck_payments_amount_exact CHECK (typeof(amount) = 'text' AND
        length(amount) BETWEEN 10 AND 33 AND amount NOT GLOB '*[^0-9.]*' AND length(amount) -
        length(replace(amount, '.', '')) = 1 AND instr(amount, '.') = length(amount) - 8 AND
        (substr(amount, 1, 1) != '0' OR instr(amount, '.') = 2))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_payments_org_customer ON payments (organization_id, customer_id)
        """
    )
    op.execute(
        """
        CREATE TABLE attachments (
                id CHAR(32) NOT NULL,
                order_id CHAR(32) NOT NULL,
                organization_id CHAR(32) NOT NULL,
                filename VARCHAR(200) NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256 VARCHAR(64) NOT NULL,
                status VARCHAR(16) DEFAULT 'pending' NOT NULL,
                deleted_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                CONSTRAINT pk_attachments PRIMARY KEY (id),
                CONSTRAINT fk_attachments_order_id_orders FOREIGN KEY(order_id, organization_id)
        REFERENCES orders (id, organization_id),
                CONSTRAINT ck_attachments_size_positive CHECK (size_bytes > 0),
                CONSTRAINT ck_attachments_status CHECK (status IN ('pending', 'ready'))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_attachments_order ON attachments (organization_id, order_id)
        """
    )
    op.execute(
        """
        CREATE TABLE order_carrot_details (
                order_id CHAR(32) NOT NULL,
                organization_id CHAR(32) NOT NULL,
                hectares BIGINT NOT NULL,
                unit_price BIGINT NOT NULL,
                price_unit VARCHAR(80),
                CONSTRAINT pk_order_carrot_details PRIMARY KEY (order_id),
                CONSTRAINT fk_order_carrot_details_order_id_orders FOREIGN KEY(order_id,
        organization_id) REFERENCES orders (id, organization_id),
                CONSTRAINT ck_order_carrot_details_hectares_positive CHECK (hectares > 0),
                CONSTRAINT ck_order_carrot_details_price_nonnegative CHECK (unit_price >= 0),
                CONSTRAINT ck_order_carrot_details_hectares_exact CHECK (typeof(hectares) =
        'integer' AND hectares BETWEEN 0 AND 99999999999999),
                CONSTRAINT ck_order_carrot_details_unit_price_exact CHECK (typeof(unit_price) =
        'integer' AND unit_price BETWEEN 0 AND 999999999999999999)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE order_potato_details (
                calculation_version VARCHAR(24) DEFAULT 'potato-v2' NOT NULL,
                order_id CHAR(32) NOT NULL,
                organization_id CHAR(32) NOT NULL,
                gross_weight BIGINT NOT NULL,
                tare_weight BIGINT NOT NULL,
                additional_shrinkage BIGINT NOT NULL,
                shrinkage_override BIGINT,
                CONSTRAINT pk_order_potato_details PRIMARY KEY (order_id),
                CONSTRAINT uq_order_potato_details_order_id UNIQUE (order_id, organization_id),
                CONSTRAINT fk_order_potato_details_order_id_orders FOREIGN KEY(order_id,
        organization_id) REFERENCES orders (id, organization_id),
                CONSTRAINT ck_order_potato_details_valid_weights CHECK (gross_weight >
        tare_weight AND tare_weight >= 0),
                CONSTRAINT ck_order_potato_details_valid_override CHECK (shrinkage_override IS
        NULL OR shrinkage_override >= 0),
                CONSTRAINT ck_order_potato_details_valid_shrinkage CHECK (additional_shrinkage
        >= 0 AND additional_shrinkage <= gross_weight - tare_weight),
                CONSTRAINT ck_order_potato_details_gross_weight_exact CHECK
        (typeof(gross_weight) = 'integer' AND gross_weight BETWEEN 0 AND 99999999999999),
                CONSTRAINT ck_order_potato_details_tare_weight_exact CHECK (typeof(tare_weight)
        = 'integer' AND tare_weight BETWEEN 0 AND 99999999999999),
                CONSTRAINT ck_order_potato_details_additional_shrinkage_exact CHECK
        (typeof(additional_shrinkage) = 'integer' AND additional_shrinkage BETWEEN 0 AND
        99999999999999),
                CONSTRAINT ck_order_potato_details_shrinkage_override_exact CHECK
        (shrinkage_override IS NULL OR (typeof(shrinkage_override) = 'integer' AND
        shrinkage_override BETWEEN 0 AND 99999999999999))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE payment_applications (
                organization_id CHAR(32) NOT NULL,
                payment_id CHAR(32) NOT NULL,
                application_date DATE NOT NULL,
                description TEXT,
                created_by CHAR(32) NOT NULL,
                creation_hash VARCHAR(64) NOT NULL,
                voided_at DATETIME,
                voided_by CHAR(32),
                void_reason VARCHAR(1000),
                id CHAR(32) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                version INTEGER DEFAULT '1' NOT NULL,
                CONSTRAINT pk_payment_applications PRIMARY KEY (id),
                CONSTRAINT uq_payment_applications_id UNIQUE (id, organization_id),
                CONSTRAINT fk_payment_applications_payment_id_payments FOREIGN KEY(payment_id,
        organization_id) REFERENCES payments (id, organization_id),
                CONSTRAINT fk_payment_applications_organization_id_memberships FOREIGN
        KEY(organization_id, created_by) REFERENCES memberships (organization_id, user_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE order_potato_lines (
                order_id CHAR(32) NOT NULL,
                grade_code VARCHAR(3) NOT NULL,
                organization_id CHAR(32) NOT NULL,
                quantity BIGINT NOT NULL,
                unit_price BIGINT NOT NULL,
                CONSTRAINT pk_order_potato_lines PRIMARY KEY (order_id, grade_code),
                CONSTRAINT fk_order_potato_lines_order_id_order_potato_details FOREIGN
        KEY(order_id, organization_id) REFERENCES order_potato_details (order_id,
        organization_id),
                CONSTRAINT ck_order_potato_lines_grade_code CHECK (grade_code IN ('1RA', '2DA',
        '3RA', '4TA')),
                CONSTRAINT ck_order_potato_lines_nonnegative CHECK (quantity >= 0 AND unit_price
        >= 0),
                CONSTRAINT ck_order_potato_lines_quantity_exact CHECK (typeof(quantity) =
        'integer' AND quantity BETWEEN 0 AND 99999999999999),
                CONSTRAINT ck_order_potato_lines_unit_price_exact CHECK (typeof(unit_price) =
        'integer' AND unit_price BETWEEN 0 AND 999999999999999999)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE payment_allocations (
                application_id CHAR(32) NOT NULL,
                order_id CHAR(32) NOT NULL,
                organization_id CHAR(32) NOT NULL,
                amount VARCHAR(40) NOT NULL,
                CONSTRAINT pk_payment_allocations PRIMARY KEY (application_id, order_id),
                CONSTRAINT fk_payment_allocations_application_id_payment_applications FOREIGN
        KEY(application_id, organization_id) REFERENCES payment_applications (id,
        organization_id),
                CONSTRAINT fk_payment_allocations_order_id_orders FOREIGN KEY(order_id,
        organization_id) REFERENCES orders (id, organization_id),
                CONSTRAINT ck_payment_allocations_amount_positive CHECK (CAST(amount AS NUMERIC)
        > 0),
                CONSTRAINT ck_payment_allocations_amount_exact CHECK (typeof(amount) = 'text'
        AND length(amount) BETWEEN 10 AND 33 AND amount NOT GLOB '*[^0-9.]*' AND length(amount)
        - length(replace(amount, '.', '')) = 1 AND instr(amount, '.') = length(amount) - 8 AND
        (substr(amount, 1, 1) != '0' OR instr(amount, '.') = 2))
        )
        """
    )
    op.execute(
        """
        CREATE INDEX ix_payment_allocations_order ON payment_allocations (organization_id,
        order_id)
        """
    )
    op.execute(
        """
        CREATE TABLE local_capture_store (
                id INTEGER NOT NULL,
                revision INTEGER NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT revision_nonnegative CHECK (revision >= 0)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE local_installation (
                id INTEGER NOT NULL,
                organization_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                PRIMARY KEY (id)
        )
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT
        RAISE(ABORT, 'Audit history is immutable'); END
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT
        RAISE(ABORT, 'Audit history is immutable'); END
        """
    )
    op.execute(
        """
        CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT, 'Use
        logical deletion; history is retained'); END
        """
    )
    op.execute(
        """
        CREATE TRIGGER customers_no_delete BEFORE DELETE ON customers BEGIN SELECT RAISE(ABORT,
        'Use logical deletion; history is retained'); END
        """
    )
    op.execute(
        """
        CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,
        'Use logical deletion; history is retained'); END
        """
    )
    op.execute(
        """
        CREATE TRIGGER payment_applications_no_delete BEFORE DELETE ON payment_applications
        BEGIN SELECT RAISE(ABORT, 'Use logical deletion; history is retained'); END
        """
    )
    op.execute(
        """
        CREATE TRIGGER payment_allocations_no_delete BEFORE DELETE ON payment_allocations BEGIN
        SELECT RAISE(ABORT, 'Use logical deletion; history is retained'); END
        """
    )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM customers")):
        raise RuntimeError("Refusing to remove a local schema with business data")
    op.execute("DROP TRIGGER orders_no_delete")
    op.execute("DROP TRIGGER customers_no_delete")
    op.execute("DROP TRIGGER payments_no_delete")
    op.execute("DROP TRIGGER payment_applications_no_delete")
    op.execute("DROP TRIGGER payment_allocations_no_delete")
    op.execute("DROP TRIGGER audit_events_no_update")
    op.execute("DROP TRIGGER audit_events_no_delete")
    op.drop_table("local_installation")
    op.drop_table("local_capture_store")
    op.drop_table("payment_allocations")
    op.drop_table("order_potato_lines")
    op.drop_table("payment_applications")
    op.drop_table("order_potato_details")
    op.drop_table("order_carrot_details")
    op.drop_table("attachments")
    op.drop_table("payments")
    op.drop_table("orders")
    op.drop_table("memberships")
    op.drop_table("customers")
    op.drop_table("audit_events")
    op.drop_table("organizations")

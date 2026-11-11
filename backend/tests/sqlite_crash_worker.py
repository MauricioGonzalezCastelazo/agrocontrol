"""Synthetic process exits before/after commit, using only an explicit test directory."""

import os
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.local.runtime import LocalRuntime
from app.modules.operations import create_customer
from app.modules.payment_schemas import PaymentInput
from app.modules.payments import create_payment
from app.modules.schemas import CustomerCreate
from app.persistence.models import Customer, Order


def main():
    if os.environ.get("AGROCONTROL_CRASH_TEST") != "1":
        raise RuntimeError("Explicit crash-test invocation required")
    directory, identifier, mode = sys.argv[1:]
    runtime = LocalRuntime(
        Path(directory), "http://127.0.0.1:5174", "synthetic-process-crash-test-bootstrap"
    )
    runtime.initialize()
    with Session(runtime.engine) as db:
        db.connection(execution_options={"sqlite_write": True})
        if mode.startswith("operation-"):
            from types import SimpleNamespace

            from sqlalchemy import event, select

            from app.modules.operations import edit_order, order_response
            from app.modules.schemas import OrderResponse, OrderUpdate
            from app.modules.transactions import execute
            from tests.test_edit_delete import update_payload

            order = db.scalar(select(Order))
            original = order_response(db, runtime.principal, order).model_dump(mode="json")
            payload = OrderUpdate.model_validate(
                update_payload(original, description="Synthetic process-interrupted edit")
            )

            def before(connection, cursor, statement, parameters, context, executemany):
                if statement.startswith("INSERT INTO operation_receipts"):
                    os._exit(17)

            def after(session):
                os._exit(18)

            if mode == "operation-before":
                event.listen(runtime.engine, "after_cursor_execute", before)
            else:
                event.listen(db, "after_commit", after)
            execute(
                db,
                runtime.principal,
                SimpleNamespace(headers={"Idempotency-Key": identifier}),
                "order.updated",
                order.id,
                payload.model_dump(mode="json"),
                lambda: order_response(
                    db, runtime.principal, edit_order(db, runtime.principal, order.id, payload)
                ),
                OrderResponse,
            )
            raise RuntimeError("Crash hook did not terminate the synthetic worker")
        if mode.startswith("payment-"):
            from sqlalchemy import event, select

            order = db.scalar(select(Order))
            payload = PaymentInput(
                id=identifier,
                customer_id=order.customer_id,
                amount="500.12345678",
                payment_date="2026-10-21",
                allocations=[{"order_id": order.id, "amount": "300.12345678"}],
            )

            def interrupted(connection, cursor, statement, parameters, context, executemany):
                if statement.startswith("INSERT INTO payment_allocations"):
                    os._exit(17)

            if mode == "payment-before":
                event.listen(runtime.engine, "after_cursor_execute", interrupted)
            create_payment(db, runtime.principal, payload)
            os._exit(18)
        if mode == "before":
            db.add(
                Customer(
                    id=UUID(identifier),
                    organization_id=runtime.principal.organization_id,
                    name="Uncommitted synthetic capture",
                )
            )
            db.flush()
            os._exit(17)
        create_customer(
            db, runtime.principal, CustomerCreate(id=identifier, name="Committed synthetic capture")
        )
        os._exit(18)


if __name__ == "__main__":
    main()

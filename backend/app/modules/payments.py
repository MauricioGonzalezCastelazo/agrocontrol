from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.modules import operations as orders
from app.modules.balances import add, amount, order_paid, payment_applied, subtract
from app.modules.payment_schemas import ApplicationInput
from app.persistence.models import Customer, Order, Payment, PaymentAllocation, PaymentApplication


def payment_scope(principal):
    clauses = [Payment.organization_id == principal.organization_id]
    if principal.role != "administrator":
        clauses.append(Payment.created_by == principal.user_id)
    return clauses


def payment_by_id(db, principal, payment_id, *, lock=False):
    query = select(Payment).where(Payment.id == payment_id, *payment_scope(principal))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    record = db.scalar(query)
    if record is None:
        raise HTTPException(404, "Cobro no disponible")
    return record


def payment_response(db, principal, payment):
    customer = orders.customer_by_id(db, principal, payment.customer_id, include_deleted=True)
    applied = payment_applied(db, payment.id)
    applications = []
    for application in db.scalars(
        select(PaymentApplication)
        .where(
            PaymentApplication.payment_id == payment.id,
            PaymentApplication.organization_id == principal.organization_id,
        )
        .order_by(PaymentApplication.created_at, PaymentApplication.id)
    ):
        lines = []
        for line, order in db.execute(
            select(PaymentAllocation, Order)
            .join(
                Order,
                Order.id == PaymentAllocation.order_id,
            )
            .where(PaymentAllocation.application_id == application.id)
        ):
            if principal.role != "administrator" and order.created_by != principal.user_id:
                continue
            lines.append(
                {
                    "order_id": str(order.id),
                    "product_type": order.product_type,
                    "remission_number": order.remission_number,
                    "order_deleted": order.deleted_at is not None,
                    "amount": amount(line.amount),
                }
            )
        applications.append(
            {
                "id": str(application.id),
                "application_date": application.application_date.isoformat(),
                "description": application.description,
                "voided_at": application.voided_at,
                "void_reason": application.void_reason,
                "allocations": lines,
            }
        )
    return {
        "id": str(payment.id),
        "customer_id": str(customer.id),
        "customer_name": customer.name,
        "amount": amount(payment.amount),
        "applied_amount": amount(applied),
        "available_credit": amount(subtract(payment.amount, applied))
        if not payment.voided_at
        else amount(0),
        "payment_date": payment.payment_date.isoformat(),
        "description": payment.description,
        "created_at": payment.created_at,
        "created_by": str(payment.created_by),
        "version": payment.version,
        "voided_at": payment.voided_at,
        "void_reason": payment.void_reason,
        "applications": applications,
    }


def lock_allocation_orders(db, principal, customer_id, allocations):
    locked = []
    for line in sorted(allocations, key=lambda line: str(line.order_id)):
        order = orders.order_by_id(db, principal, line.order_id, lock=True)
        if order.customer_id != customer_id:
            raise HTTPException(422, "Todos los pedidos deben pertenecer al cliente seleccionado")
        if order.remission_number is None:
            raise HTTPException(422, "Completa la remisión del pedido antes de aplicarle un cobro")
        if line.amount > subtract(order.total_amount, order_paid(db, order.id)):
            raise HTTPException(
                409,
                "El importe aplicado supera el saldo del pedido. "
                "El excedente puede quedar a favor del cliente.",
            )
        locked.append(order)
    return locked


def bump_orders(db, principal, records):
    for order in records:
        order.version += 1
        order.updated_at = func.now()
        order.updated_by = principal.user_id


def insert_application(db, principal, payment, payload):
    total = add(line.amount for line in payload.allocations)
    if total > subtract(payment.amount, payment_applied(db, payment.id)):
        raise HTTPException(
            409, "El importe aplicado supera el saldo a favor disponible de este cobro"
        )
    locked = lock_allocation_orders(db, principal, payment.customer_id, payload.allocations)
    application = PaymentApplication(
        id=payload.id,
        organization_id=principal.organization_id,
        payment_id=payment.id,
        application_date=payload.application_date,
        description=payload.description,
        created_by=principal.user_id,
        creation_hash=orders.fingerprint(payload),
    )
    db.add(application)
    db.flush()
    for line in payload.allocations:
        db.add(
            PaymentAllocation(
                application_id=application.id,
                order_id=line.order_id,
                organization_id=principal.organization_id,
                amount=line.amount,
            )
        )
    bump_orders(db, principal, locked)
    orders.audit(db, principal, "payment.applied", application.id)
    return application


def create_payment(db, principal, payload):
    signature = orders.fingerprint(payload)

    def retry():
        payment = payment_by_id(db, principal, payload.id)
        if payment.creation_hash != signature or payment.created_by != principal.user_id:
            raise HTTPException(409, "Este identificador ya corresponde a otro cobro")
        return payment

    if db.get(Payment, payload.id):
        return retry()
    orders.customer_by_id(db, principal, payload.customer_id, include_deleted=True, lock=True)
    if add(line.amount for line in payload.allocations) > payload.amount:
        raise HTTPException(422, "La suma aplicada no puede superar el dinero recibido")
    payment = Payment(
        id=payload.id,
        organization_id=principal.organization_id,
        customer_id=payload.customer_id,
        amount=payload.amount,
        payment_date=payload.payment_date,
        description=payload.description,
        created_by=principal.user_id,
        creation_hash=signature,
    )
    try:
        db.add(payment)
        db.flush()
        if payload.allocations:
            insert_application(
                db,
                principal,
                payment,
                ApplicationInput(
                    id=payment.id,
                    application_date=payload.payment_date,
                    description=payload.description,
                    allocations=payload.allocations,
                ),
            )
        orders.audit(db, principal, "payment.created", payment.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        return retry()
    except HTTPException:
        db.rollback()
        raise
    db.refresh(payment)
    return payment


def apply_credit(db, principal, payment_id, payload):
    payment = payment_by_id(db, principal, payment_id)
    orders.customer_by_id(db, principal, payment.customer_id, include_deleted=True, lock=True)
    payment = payment_by_id(db, principal, payment_id, lock=True)
    existing = db.get(PaymentApplication, payload.id)
    if existing:
        if (
            existing.payment_id != payment.id
            or existing.organization_id != principal.organization_id
            or existing.creation_hash != orders.fingerprint(payload)
            or existing.created_by != principal.user_id
        ):
            raise HTTPException(409, "Este identificador corresponde a otra aplicación")
        return payment
    if payment.voided_at:
        raise HTTPException(409, "El cobro está anulado")
    try:
        insert_application(db, principal, payment, payload)
        payment.version += 1
        db.commit()
    except (IntegrityError, HTTPException) as error:
        db.rollback()
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(
            409, "La aplicación cambió. Revisa el cobro antes de reintentar."
        ) from None
    db.refresh(payment)
    return payment


def void_payment(db, principal, payment_id, payload, application_id=None):
    payment = payment_by_id(db, principal, payment_id)
    orders.customer_by_id(db, principal, payment.customer_id, include_deleted=True, lock=True)
    payment = payment_by_id(db, principal, payment_id, lock=True)
    application = None
    if application_id:
        application = db.get(PaymentApplication, application_id)
        if not application or application.payment_id != payment.id:
            raise HTTPException(404, "Aplicación no disponible")
    target = application or payment
    if target.voided_at:
        return payment
    if payment.voided_at:
        raise HTTPException(409, "El cobro ya fue anulado")
    if payment.version != payload.expected_version:
        raise HTTPException(409, "El cobro cambió. Actualiza sus saldos antes de anular.")
    clauses = [PaymentApplication.payment_id == payment.id, PaymentApplication.voided_at.is_(None)]
    if application:
        clauses.append(PaymentApplication.id == application.id)
    ids = set(
        db.scalars(
            select(PaymentAllocation.order_id)
            .join(PaymentApplication, PaymentApplication.id == PaymentAllocation.application_id)
            .where(*clauses)
        )
    )
    locked = list(
        db.scalars(
            select(Order)
            .where(Order.id.in_(ids), Order.organization_id == principal.organization_id)
            .order_by(Order.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    if principal.role != "administrator" and any(
        order.created_by != principal.user_id for order in locked
    ):
        raise HTTPException(
            403, "Un administrador debe revisar las aplicaciones de otros operadores"
        )
    target.voided_at = func.now()
    target.voided_by = principal.user_id
    target.void_reason = payload.reason
    payment.version += 1
    bump_orders(db, principal, locked)
    orders.audit(
        db, principal, "payment.application_voided" if application else "payment.voided", target.id
    )
    db.commit()
    db.refresh(payment)
    return payment


def accounts(db, principal, q="", customer_id=None, offset=0, limit=50):
    query = select(Customer).where(Customer.organization_id == principal.organization_id)
    if customer_id:
        query = query.where(Customer.id == customer_id)
    if q.strip():
        query = query.where(Customer.name.icontains(q.strip(), autoescape=True))
    customers = list(db.scalars(query.order_by(Customer.name, Customer.id)))
    results = []
    for customer in customers:
        visible_orders = list(
            db.scalars(
                select(Order).where(
                    Order.customer_id == customer.id, *orders.order_scope(principal)
                )
            )
        )
        receipts = list(
            db.scalars(
                select(Payment).where(
                    Payment.customer_id == customer.id,
                    Payment.voided_at.is_(None),
                    *payment_scope(principal),
                )
            )
        )
        total = add(order.total_amount for order in visible_orders)
        paid = add(order_paid(db, order.id) for order in visible_orders)
        received = add(payment.amount for payment in receipts)
        credit = add(
            subtract(payment.amount, payment_applied(db, payment.id)) for payment in receipts
        )
        if customer.deleted_at and not visible_orders and not receipts:
            continue
        results.append(
            {
                "customer_id": str(customer.id),
                "customer_name": customer.name,
                "active": customer.active and not customer.deleted_at,
                "total_orders": len(visible_orders),
                "total_amount": amount(total),
                "total_paid": amount(paid),
                "remaining_amount": amount(subtract(total, paid)),
                "total_received": amount(received),
                "available_credit": amount(credit),
            }
        )
    return {"items": results[offset : offset + limit], "total": len(results)}

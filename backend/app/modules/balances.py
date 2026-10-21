from decimal import Decimal, localcontext

from sqlalchemy import select

from app.persistence.models import Payment, PaymentAllocation, PaymentApplication


def add(values):
    with localcontext() as context:
        context.prec = 80
        return sum(values, Decimal("0"))


def subtract(left, right):
    with localcontext() as context:
        context.prec = 80
        return left - right


def amount(value):
    return format(value, ".8f")


def active_allocations():
    return (
        select(PaymentAllocation)
        .join(PaymentApplication, PaymentApplication.id == PaymentAllocation.application_id)
        .join(Payment, Payment.id == PaymentApplication.payment_id)
        .where(Payment.voided_at.is_(None), PaymentApplication.voided_at.is_(None))
    )


def order_paid(db, order_id):
    return add(
        line.amount
        for line in db.scalars(active_allocations().where(PaymentAllocation.order_id == order_id))
    )


def payment_applied(db, payment_id):
    return add(
        line.amount for line in db.scalars(active_allocations().where(Payment.id == payment_id))
    )


def order_has_history(db, order_id):
    return (
        db.scalar(
            select(PaymentAllocation.order_id)
            .where(PaymentAllocation.order_id == order_id)
            .limit(1)
        )
        is not None
    )


def order_has_active_payments(db, order_id):
    return (
        db.scalar(active_allocations().where(PaymentAllocation.order_id == order_id).limit(1))
        is not None
    )

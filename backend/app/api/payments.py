from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.business import Current, Database
from app.modules import payments as service
from app.modules.payment_schemas import (
    AccountPage,
    ApplicationInput,
    PaymentInput,
    PaymentPage,
    PaymentResponse,
    VoidInput,
)
from app.persistence.models import Payment

router = APIRouter(prefix="/api/v1", tags=["payments"])


@router.get("/customer-accounts", response_model=AccountPage)
def accounts(
    db: Database,
    principal: Current,
    customer_id: UUID | None = None,
    q: str = Query("", max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
):
    return service.accounts(db, principal, q, customer_id, offset, limit)


@router.get("/payments", response_model=PaymentPage)
def payments(
    db: Database,
    principal: Current,
    customer_id: UUID | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    clauses = service.payment_scope(principal)
    if customer_id:
        clauses.append(Payment.customer_id == customer_id)
    return {
        "items": [
            service.payment_response(db, principal, payment)
            for payment in db.scalars(
                select(Payment)
                .where(*clauses)
                .order_by(Payment.payment_date.desc(), Payment.created_at.desc(), Payment.id)
                .offset(offset)
                .limit(limit)
            )
        ],
        "total": db.scalar(select(func.count()).select_from(Payment).where(*clauses)),
    }


@router.post("/payments", status_code=201, response_model=PaymentResponse)
def create_payment(payload: PaymentInput, db: Database, principal: Current):
    return service.payment_response(db, principal, service.create_payment(db, principal, payload))


@router.get("/payments/{payment_id}", response_model=PaymentResponse)
def payment(payment_id: UUID, db: Database, principal: Current):
    return service.payment_response(db, principal, service.payment_by_id(db, principal, payment_id))


@router.post("/payments/{payment_id}/applications", status_code=201, response_model=PaymentResponse)
def apply(payment_id: UUID, payload: ApplicationInput, db: Database, principal: Current):
    return service.payment_response(
        db, principal, service.apply_credit(db, principal, payment_id, payload)
    )


@router.post("/payments/{payment_id}/void", response_model=PaymentResponse)
def void(payment_id: UUID, payload: VoidInput, db: Database, principal: Current):
    return service.payment_response(
        db, principal, service.void_payment(db, principal, payment_id, payload)
    )


@router.post(
    "/payments/{payment_id}/applications/{application_id}/void", response_model=PaymentResponse
)
def undo(
    payment_id: UUID, application_id: UUID, payload: VoidInput, db: Database, principal: Current
):
    return service.payment_response(
        db, principal, service.void_payment(db, principal, payment_id, payload, application_id)
    )

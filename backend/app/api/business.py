from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, administrator, current_principal
from app.modules import operations as service
from app.modules.schemas import (
    CustomerCreate,
    CustomerPage,
    CustomerResponse,
    CustomerUpdate,
    DeletedResponse,
    OrderCreate,
    OrderPage,
    OrderResponse,
    OrderUpdate,
)
from app.persistence.database import get_db
from app.persistence.models import Customer, Order

router = APIRouter(prefix="/api/v1")
Database = Annotated[Session, Depends(get_db)]
Current = Annotated[Principal, Depends(current_principal)]
Admin = Annotated[Principal, Depends(administrator)]


@router.get("/customers", response_model=CustomerPage, tags=["customers"])
def customers(
    db: Database,
    principal: Current,
    q: str = Query("", max_length=200),
    active: bool | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
):
    clauses = [Customer.organization_id == principal.organization_id, Customer.deleted_at.is_(None)]
    if q.strip():
        clauses.append(Customer.name.icontains(q.strip(), autoescape=True))
    if active is not None:
        clauses.append(Customer.active == active)
    return CustomerPage(
        items=[
            CustomerResponse.model_validate(c)
            for c in db.scalars(
                select(Customer)
                .where(*clauses)
                .order_by(Customer.name, Customer.id)
                .offset(offset)
                .limit(limit)
            )
        ],
        total=db.scalar(select(func.count()).select_from(Customer).where(*clauses)),
    )


@router.post("/customers", response_model=CustomerResponse, status_code=201, tags=["customers"])
def create_customer(payload: CustomerCreate, db: Database, principal: Current):
    return service.create_customer(db, principal, payload)


@router.get("/customers/{customer_id}", response_model=CustomerResponse, tags=["customers"])
def customer(customer_id: UUID, db: Database, principal: Current):
    return service.customer_by_id(db, principal, customer_id)


@router.patch("/customers/{customer_id}", response_model=CustomerResponse, tags=["customers"])
def edit_customer(customer_id: UUID, payload: CustomerUpdate, db: Database, principal: Admin):
    return service.edit_customer(db, principal, customer_id, payload)


@router.delete("/customers/{customer_id}", response_model=DeletedResponse, tags=["customers"])
def delete_customer(
    customer_id: UUID, db: Database, principal: Admin, expected_version: int = Query(gt=0)
):
    service.delete_customer(db, principal, customer_id, expected_version)
    return DeletedResponse(id=customer_id)


@router.get("/orders", response_model=OrderPage, tags=["orders"])
def orders(
    db: Database,
    principal: Current,
    q: str = Query("", max_length=200),
    product_type: Literal["carrot", "potato"] | None = None,
    customer_id: UUID | None = None,
    remission_number: int | None = Query(None, gt=0),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    clauses = service.order_scope(principal)
    if q.strip():
        clauses.append(
            or_(
                Customer.name.icontains(q.strip(), autoescape=True),
                cast(Order.remission_number, String).contains(q.strip(), autoescape=True),
            )
        )
    if remission_number is not None:
        clauses.append(Order.remission_number == remission_number)
    if product_type:
        clauses.append(Order.product_type == product_type)
    if customer_id:
        clauses.append(Order.customer_id == customer_id)
    query = (
        select(Order)
        .join(
            Customer,
            (Customer.id == Order.customer_id)
            & (Customer.organization_id == Order.organization_id),
        )
        .where(*clauses)
    )
    items = db.scalars(
        query.order_by(Order.order_date.desc(), Order.created_at.desc(), Order.id)
        .offset(offset)
        .limit(limit)
    )
    return OrderPage(
        items=[service.order_response(db, principal, order) for order in items],
        total=db.scalar(select(func.count()).select_from(query.subquery())),
    )


@router.post("/orders", response_model=OrderResponse, status_code=201, tags=["orders"])
def create_order(payload: OrderCreate, db: Database, principal: Current):
    return service.order_response(db, principal, service.create_order(db, principal, payload))


@router.get("/orders/{order_id}", response_model=OrderResponse, tags=["orders"])
def order(order_id: UUID, db: Database, principal: Current):
    return service.order_response(db, principal, service.order_by_id(db, principal, order_id))


@router.patch("/orders/{order_id}", response_model=OrderResponse, tags=["orders"])
def edit_order(order_id: UUID, payload: OrderUpdate, db: Database, principal: Current):
    return service.order_response(
        db, principal, service.edit_order(db, principal, order_id, payload)
    )


@router.delete("/orders/{order_id}", response_model=DeletedResponse, tags=["orders"])
def delete_order(
    order_id: UUID, db: Database, principal: Current, expected_version: int = Query(gt=0)
):
    service.delete_order(db, principal, order_id, expected_version)
    return DeletedResponse(id=order_id)

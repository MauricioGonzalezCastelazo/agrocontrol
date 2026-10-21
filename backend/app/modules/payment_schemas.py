from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field, model_validator

from app.modules.schemas import Input


def money_input(value):
    import re

    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d{1,8})?", value):
        raise ValueError("Usa un importe decimal con hasta ocho decimales")
    return value


Money = Annotated[
    Decimal, BeforeValidator(money_input), Field(gt=0, max_digits=32, decimal_places=8)
]


class AllocationInput(Input):
    order_id: UUID
    amount: Money


class ApplicationInput(Input):
    id: UUID
    application_date: date
    description: str | None = Field(default=None, max_length=4000)
    allocations: list[AllocationInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_orders(self):
        if len({line.order_id for line in self.allocations}) != len(self.allocations):
            raise ValueError("Selecciona cada pedido una sola vez")
        self.allocations.sort(key=lambda line: str(line.order_id))
        return self


class PaymentInput(Input):
    id: UUID
    customer_id: UUID
    amount: Money
    payment_date: date
    description: str | None = Field(default=None, max_length=4000)
    allocations: list[AllocationInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_orders(self):
        if len({line.order_id for line in self.allocations}) != len(self.allocations):
            raise ValueError("Selecciona cada pedido una sola vez")
        self.allocations.sort(key=lambda line: str(line.order_id))
        return self


class VoidInput(Input):
    expected_version: int = Field(gt=0, strict=True)
    reason: str = Field(min_length=1, max_length=1000)


class AllocationResponse(BaseModel):
    order_id: UUID
    product_type: Literal["carrot", "potato"]
    remission_number: int | None
    amount: str
    order_deleted: bool


class ApplicationResponse(BaseModel):
    id: UUID
    application_date: date
    description: str | None
    voided_at: datetime | None
    void_reason: str | None
    allocations: list[AllocationResponse]


class PaymentResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: str
    amount: str
    applied_amount: str
    available_credit: str
    payment_date: date
    description: str | None
    created_at: datetime
    created_by: UUID
    version: int
    voided_at: datetime | None
    void_reason: str | None
    applications: list[ApplicationResponse]


class PaymentPage(BaseModel):
    items: list[PaymentResponse]
    total: int


class AccountResponse(BaseModel):
    customer_id: UUID
    customer_name: str
    active: bool
    total_orders: int
    total_amount: str
    total_paid: str
    remaining_amount: str
    total_received: str
    available_credit: str


class AccountPage(BaseModel):
    items: list[AccountResponse]
    total: int

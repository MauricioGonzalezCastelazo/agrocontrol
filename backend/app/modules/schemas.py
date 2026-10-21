import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, localcontext
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

from app.core.config import get_settings
from app.domain.attachments import allowed_filename
from app.domain.potato import GRADES, calculate_potato


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CustomerCreate(Input):
    id: UUID
    name: str = Field(min_length=1, max_length=200)
    active: bool = Field(default=True, strict=True)
    notes: str | None = Field(default=None, max_length=2000)


class CustomerUpdate(Input):
    name: str = Field(min_length=1, max_length=200)
    active: bool = Field(strict=True)
    notes: str | None = Field(default=None, max_length=2000)
    expected_version: int = Field(gt=0, strict=True)


class CustomerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    active: bool
    notes: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class CustomerPage(BaseModel):
    items: list[CustomerResponse]
    total: int


def decimal_input(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.\d{1,4})?", value):
        raise ValueError("Usa una cadena decimal positiva con hasta cuatro decimales")
    return value


Hectares = Annotated[
    Decimal, BeforeValidator(decimal_input), Field(gt=0, max_digits=14, decimal_places=4)
]
UnitPrice = Annotated[
    Decimal, BeforeValidator(decimal_input), Field(ge=0, max_digits=18, decimal_places=4)
]


def calculate_total(hectares: Decimal, price: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 40
        return (hectares * price).quantize(Decimal("0.00000001"))


class CarrotInput(Input):
    hectares: Hectares
    unit_price: UnitPrice


NonnegativeQuantity = Annotated[
    Decimal, BeforeValidator(decimal_input), Field(ge=0, max_digits=14, decimal_places=4)
]


class PotatoLineInput(Input):
    grade_code: Literal["1RA", "2DA", "3RA", "4TA"]
    quantity: NonnegativeQuantity = Decimal("0")
    unit_price: UnitPrice | None = None


class PotatoInput(Input):
    gross_weight: NonnegativeQuantity
    tare_weight: NonnegativeQuantity
    additional_shrinkage: NonnegativeQuantity = Decimal("0")
    shrinkage_override: NonnegativeQuantity | None = None
    lines: list[PotatoLineInput] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def validate_calculation(self):
        calculate_potato(self.model_dump())
        self.lines.sort(key=lambda line: GRADES.index(line.grade_code))
        for line in self.lines:
            if line.unit_price is None:
                line.unit_price = Decimal("0")
        return self


class PotatoLineResult(BaseModel):
    grade_code: Literal["1RA", "2DA", "3RA", "4TA"]
    quantity: str
    unit_price: str
    allocated_unit_weight: str
    allocated_net_weight: str
    line_total: str


class PotatoResult(BaseModel):
    calculation_version: str
    gross_weight: str
    tare_weight: str
    additional_shrinkage: str
    shrinkage_override: str | None
    shrinkage: str
    weight: str
    total_quantity: str
    weight_after_shrinkage: str
    net_unit_weight: str
    net_total_weight: str
    total_amount: str
    lines: list[PotatoLineResult]


class AttachmentInput(Input):
    id: UUID
    filename: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(gt=0, strict=True)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @field_validator("filename")
    @classmethod
    def safe_name(cls, value):
        if (
            "/" in value
            or "\\" in value
            or any(unicodedata.category(c).startswith("C") for c in value)
        ):
            raise ValueError("Nombre de archivo no válido")
        if value in {".", ".."}:
            raise ValueError("Nombre de archivo no válido")
        return value

    @field_validator("size_bytes")
    @classmethod
    def limited_size(cls, value):
        if value > get_settings().max_attachment_bytes:
            raise ValueError("El archivo excede el tamaño permitido")
        return value


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    filename: str
    size_bytes: int
    sha256: str
    status: Literal["pending", "ready"]


class OrderFields(Input):
    customer_id: UUID
    remission_number: int | None = Field(default=None, gt=0, le=2147483647, strict=True)
    product_type: Literal["carrot", "potato"]
    order_date: date
    details: CarrotInput | PotatoInput
    description: str | None = Field(default=None, max_length=4000)
    attachments: list[AttachmentInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def attachment_limits(self):
        if (self.product_type == "carrot") != isinstance(self.details, CarrotInput):
            raise ValueError("Los detalles no corresponden al producto seleccionado")
        config = get_settings()
        if len(self.attachments) > config.max_attachments:
            raise ValueError("Demasiados archivos")
        if len({a.id for a in self.attachments}) != len(self.attachments):
            raise ValueError("Identificadores de archivos repetidos")
        if sum(a.size_bytes for a in self.attachments) > config.max_order_attachment_bytes:
            raise ValueError("Los archivos exceden el tamaño total permitido")
        return self


class OrderCreate(OrderFields):
    id: UUID

    @model_validator(mode="after")
    def attachment_types(self):
        if any(not allowed_filename(file.filename) for file in self.attachments):
            raise ValueError(
                "Formato de archivo no permitido. Usa imágenes o documentos de la lista admitida."
            )
        return self


class OrderUpdate(OrderFields):
    expected_version: int = Field(gt=0, strict=True)


class DeletedResponse(BaseModel):
    id: UUID
    deleted: Literal[True] = True


class OrderResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: str
    remission_number: int | None
    total_paid: str
    remaining_amount: str
    payment_status: Literal["unpaid", "partial", "paid"]
    product_type: Literal["carrot", "potato"]
    order_date: date
    currency: Literal["MXN"]
    description: str | None
    hectares: str | None = None
    unit_price: str | None = None
    potato: PotatoResult | None = None
    total_amount: str
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    updated_by: UUID | None = None
    version: int
    attachments: list[AttachmentResponse]
    attachment_status: Literal["complete", "pending"]


class OrderPage(BaseModel):
    items: list[OrderResponse]
    total: int

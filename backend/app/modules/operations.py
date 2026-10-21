import hashlib
import json
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal
from app.domain.attachments import allowed_filename
from app.domain.potato import RULES, calculate_potato
from app.modules.balances import (
    amount,
    order_has_active_payments,
    order_has_history,
    order_paid,
    subtract,
)
from app.modules.schemas import (
    AttachmentResponse,
    CarrotInput,
    CustomerCreate,
    CustomerUpdate,
    OrderCreate,
    OrderResponse,
    OrderUpdate,
    calculate_total,
)
from app.persistence.models import (
    Attachment,
    AuditEvent,
    CarrotDetails,
    Customer,
    Order,
    PotatoDetails,
    PotatoGradeLine,
)


def fingerprint(payload) -> str:
    def canonical(value):
        if isinstance(value, Decimal):
            return format(value.normalize(), "f")
        if isinstance(value, dict):
            return {k: canonical(v) for k, v in value.items()}
        if isinstance(value, list):
            return [canonical(v) for v in value]
        return value

    values = payload.model_dump()
    if values.get("remission_number") is None:
        values.pop("remission_number", None)
    # Automatic shrinkage keeps historical request fingerprints stable.
    if (
        values.get("product_type") == "potato"
        and values["details"].get("shrinkage_override") is None
    ):
        values["details"].pop("shrinkage_override", None)
    data = json.dumps(canonical(values), sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(data.encode()).hexdigest()


def audit(db: Session, principal: Principal, action: str, record_id: UUID):
    db.add(
        AuditEvent(
            organization_id=principal.organization_id,
            actor_id=principal.user_id,
            action=action,
            record_id=record_id,
        )
    )


def customer_by_id(
    db: Session, principal: Principal, customer_id: UUID, *, include_deleted=False, lock=False
) -> Customer:
    statement = select(Customer).where(
        Customer.id == customer_id, Customer.organization_id == principal.organization_id
    )
    customer = db.scalar(statement.with_for_update() if lock else statement)
    if customer is None:
        raise HTTPException(404, "Cliente no disponible")
    if customer.deleted_at is not None and not include_deleted:
        raise HTTPException(410, "Este cliente fue eliminado")
    return customer


def create_customer(db: Session, principal: Principal, payload: CustomerCreate) -> Customer:
    signature = fingerprint(payload)

    def retry():
        existing = db.get(Customer, payload.id)
        if (
            existing
            and existing.organization_id == principal.organization_id
            and existing.creation_hash == signature
        ):
            if existing.deleted_at is not None:
                raise HTTPException(410, "Este cliente fue eliminado")
            return existing
        raise HTTPException(409, "No se pudo registrar el cliente con este identificador")

    if db.get(Customer, payload.id):
        return retry()
    customer = Customer(
        **payload.model_dump(), organization_id=principal.organization_id, creation_hash=signature
    )
    db.add(customer)
    audit(db, principal, "customer.created", payload.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return retry()
    db.refresh(customer)
    return customer


def edit_customer(db: Session, principal: Principal, customer_id: UUID, payload: CustomerUpdate):
    customer_by_id(db, principal, customer_id)
    result = db.execute(
        update(Customer)
        .where(
            Customer.id == customer_id,
            Customer.organization_id == principal.organization_id,
            Customer.version == payload.expected_version,
            Customer.deleted_at.is_(None),
        )
        .values(
            **payload.model_dump(exclude={"expected_version"}),
            version=Customer.version + 1,
            updated_at=func.now(),
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "El cliente cambió. Actualiza la página antes de editarlo.")
    audit(db, principal, "customer.updated", customer_id)
    db.commit()
    db.expire_all()
    return customer_by_id(db, principal, customer_id)


def order_scope(principal: Principal, *, include_deleted=False):
    clauses = [Order.organization_id == principal.organization_id]
    if not include_deleted:
        clauses.append(Order.deleted_at.is_(None))
    if principal.role != "administrator":
        clauses.append(Order.created_by == principal.user_id)
    return clauses


def order_by_id(
    db: Session, principal: Principal, order_id: UUID, *, include_deleted=False, lock=False
) -> Order:
    query = select(Order).where(Order.id == order_id, *order_scope(principal, include_deleted=True))
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    order = db.scalar(query)
    if order is None:
        raise HTTPException(404, "Pedido no disponible")
    if order.deleted_at is not None and not include_deleted:
        raise HTTPException(410, "Este pedido fue eliminado")
    return order


def order_response(db: Session, principal: Principal, order: Order) -> OrderResponse:
    detail = db.get(CarrotDetails if order.product_type == "carrot" else PotatoDetails, order.id)
    if detail is None:
        raise HTTPException(503, "Los detalles del pedido no están disponibles")
    potato = None
    if order.product_type == "potato":
        lines = list(
            db.scalars(
                select(PotatoGradeLine)
                .where(
                    PotatoGradeLine.order_id == order.id,
                    PotatoGradeLine.organization_id == principal.organization_id,
                )
                .order_by(PotatoGradeLine.grade_code)
            )
        )
        potato = calculate_potato(
            {
                "gross_weight": detail.gross_weight,
                "tare_weight": detail.tare_weight,
                "additional_shrinkage": detail.additional_shrinkage,
                "shrinkage_override": detail.shrinkage_override,
                "lines": [
                    {
                        "grade_code": line.grade_code,
                        "quantity": line.quantity,
                        "unit_price": line.unit_price,
                    }
                    for line in lines
                ],
            },
            version=detail.calculation_version,
        )
    customer = customer_by_id(db, principal, order.customer_id, include_deleted=True)
    attachments = list(
        db.scalars(
            select(Attachment)
            .where(
                Attachment.order_id == order.id,
                Attachment.organization_id == principal.organization_id,
                Attachment.deleted_at.is_(None),
            )
            .order_by(Attachment.created_at, Attachment.id)
        )
    )
    paid = order_paid(db, order.id)
    remaining = subtract(order.total_amount, paid)
    return OrderResponse(
        id=order.id,
        customer_id=customer.id,
        customer_name=customer.name,
        remission_number=order.remission_number,
        total_paid=amount(paid),
        remaining_amount=amount(remaining),
        payment_status="paid" if remaining == 0 else "partial" if paid else "unpaid",
        product_type=order.product_type,
        order_date=order.order_date,
        currency=order.currency,
        description=order.description,
        hectares=format(detail.hectares, ".4f") if order.product_type == "carrot" else None,
        unit_price=format(detail.unit_price, ".4f") if order.product_type == "carrot" else None,
        potato=potato,
        total_amount=format(order.total_amount, ".8f"),
        created_by=order.created_by,
        created_at=order.created_at,
        updated_at=order.updated_at,
        updated_by=order.updated_by,
        version=order.version,
        attachments=[AttachmentResponse.model_validate(a) for a in attachments],
        attachment_status="pending"
        if any(a.status != "ready" for a in attachments)
        else "complete",
    )


def payload_total(payload):
    if isinstance(payload.details, CarrotInput):
        return calculate_total(payload.details.hectares, payload.details.unit_price)
    return Decimal(calculate_potato(payload.details.model_dump())["total_amount"])


def store_details(db, order_id, principal, payload, *, replace=False):
    if replace:
        for model in (PotatoGradeLine, PotatoDetails, CarrotDetails):
            db.execute(
                delete(model).where(
                    model.order_id == order_id, model.organization_id == principal.organization_id
                )
            )
    if isinstance(payload.details, CarrotInput):
        db.add(
            CarrotDetails(
                order_id=order_id,
                organization_id=principal.organization_id,
                hectares=payload.details.hectares,
                unit_price=payload.details.unit_price,
                price_unit="hectare",
            )
        )
    else:
        db.add(
            PotatoDetails(
                order_id=order_id,
                organization_id=principal.organization_id,
                calculation_version=RULES["version"],
                **payload.details.model_dump(exclude={"lines"}),
            )
        )
        db.flush()
        db.add_all(
            [
                PotatoGradeLine(
                    order_id=order_id,
                    organization_id=principal.organization_id,
                    **line.model_dump(),
                )
                for line in payload.details.lines
            ]
        )


def create_order(db: Session, principal: Principal, payload: OrderCreate) -> Order:
    signature = fingerprint(payload)

    def retry():
        existing = db.get(Order, payload.id)
        if (
            existing
            and existing.organization_id == principal.organization_id
            and existing.created_by == principal.user_id
            and existing.creation_hash == signature
        ):
            if existing.deleted_at is not None:
                raise HTTPException(410, "Este pedido fue eliminado")
            return existing
        raise HTTPException(409, "No se pudo registrar el pedido con este identificador")

    if db.get(Order, payload.id):
        return retry()
    if payload.remission_number is None:
        raise HTTPException(422, "Introduce el número de remisión del pedido")
    customer = customer_by_id(db, principal, payload.customer_id, include_deleted=True, lock=True)
    if not customer.active or customer.deleted_at is not None:
        raise HTTPException(409, "Selecciona un cliente activo")
    order = Order(
        id=payload.id,
        organization_id=principal.organization_id,
        customer_id=customer.id,
        product_type=payload.product_type,
        remission_number=payload.remission_number,
        order_date=payload.order_date,
        currency="MXN",
        description=payload.description,
        created_by=principal.user_id,
        updated_by=principal.user_id,
        total_amount=payload_total(payload),
        creation_hash=signature,
    )
    try:
        db.add(order)
        db.flush()
        store_details(db, order.id, principal, payload)
        for attachment in payload.attachments:
            db.add(
                Attachment(
                    **attachment.model_dump(),
                    order_id=order.id,
                    organization_id=principal.organization_id,
                )
            )
        audit(db, principal, "order.created", order.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.scalar(
            select(Order.id).where(
                Order.organization_id == principal.organization_id,
                Order.product_type == payload.product_type,
                Order.remission_number == payload.remission_number,
                Order.deleted_at.is_(None),
            )
        ):
            if not db.get(Order, payload.id):
                raise HTTPException(
                    409,
                    "Ya existe esa remisión en un pedido vigente de este producto",
                ) from None
        return retry()
    db.refresh(order)
    return order


def delete_customer(db: Session, principal: Principal, customer_id: UUID, expected_version: int):
    customer = customer_by_id(db, principal, customer_id, include_deleted=True)
    if customer.deleted_at is not None:
        return
    result = db.execute(
        update(Customer)
        .where(
            Customer.id == customer_id,
            Customer.organization_id == principal.organization_id,
            Customer.deleted_at.is_(None),
            Customer.version == expected_version,
        )
        .values(
            deleted_at=func.now(), active=False, version=Customer.version + 1, updated_at=func.now()
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "El cliente cambió. Recarga antes de eliminarlo.")
    audit(db, principal, "customer.deleted", customer_id)
    db.commit()


def delete_order(db: Session, principal: Principal, order_id: UUID, expected_version: int):
    order = order_by_id(db, principal, order_id, include_deleted=True, lock=True)
    if order.deleted_at is not None:
        return
    if order_has_active_payments(db, order_id):
        raise HTTPException(
            409,
            "El pedido todavía tiene cobros vigentes. "
            "Anúlalos o quita sus abonos antes de eliminarlo.",
        )
    result = db.execute(
        update(Order)
        .where(
            Order.id == order_id,
            *order_scope(principal),
            Order.version == expected_version,
        )
        .values(
            deleted_at=func.now(),
            version=Order.version + 1,
            updated_at=func.now(),
            updated_by=principal.user_id,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "El pedido cambió. Recarga antes de eliminarlo.")
    audit(db, principal, "order.deleted", order_id)
    db.commit()


def edit_order(db: Session, principal: Principal, order_id: UUID, payload: OrderUpdate):
    order = order_by_id(db, principal, order_id)
    signature = fingerprint(payload)
    if order.last_update_hash == signature:
        return order
    # An inactive/deleted original customer can remain on its historical order.
    if payload.customer_id != order.customer_id:
        customer = customer_by_id(
            db, principal, payload.customer_id, include_deleted=True, lock=True
        )
        if not customer.active or customer.deleted_at is not None:
            raise HTTPException(409, "Selecciona un cliente activo")
    order = order_by_id(db, principal, order_id, lock=True)
    remission = (
        payload.remission_number if payload.remission_number is not None else order.remission_number
    )
    if order_has_history(db, order_id) and (
        payload.customer_id != order.customer_id
        or payload.product_type != order.product_type
        or remission != order.remission_number
    ):
        raise HTTPException(
            409, "Un pedido con historial de cobros conserva cliente, producto y remisión"
        )
    if payload_total(payload) < order_paid(db, order_id):
        raise HTTPException(409, "El total del pedido no puede quedar por debajo de lo ya pagado")
    try:
        changed = db.execute(
            update(Order)
            .where(
                Order.id == order_id,
                *order_scope(principal),
                Order.version == payload.expected_version,
            )
            .values(
                product_type=payload.product_type,
                remission_number=remission,
                customer_id=payload.customer_id,
                order_date=payload.order_date,
                description=payload.description,
                total_amount=payload_total(payload),
                version=Order.version + 1,
                updated_at=func.now(),
                last_update_hash=signature,
                updated_by=principal.user_id,
            )
            .execution_options(synchronize_session=False)
        )
        if changed.rowcount != 1:
            db.rollback()
            raise HTTPException(
                409, "El pedido cambió. Recarga y revisa los datos antes de editarlo."
            )
        store_details(db, order_id, principal, payload, replace=True)
        existing = {
            a.id: a
            for a in db.scalars(
                select(Attachment).where(
                    Attachment.order_id == order_id,
                    Attachment.organization_id == principal.organization_id,
                )
            )
        }
        wanted = {a.id for a in payload.attachments}
        for manifest in payload.attachments:
            previous = existing.get(manifest.id)
            if previous:
                if previous.deleted_at is not None or any(
                    getattr(previous, key) != value for key, value in manifest.model_dump().items()
                ):
                    raise HTTPException(
                        409, "Un adjunto cambió. Recarga el pedido antes de editarlo."
                    )
            else:
                if not allowed_filename(manifest.filename):
                    raise HTTPException(422, "Formato de archivo no permitido")
                if db.get(Attachment, manifest.id):
                    raise HTTPException(
                        409, "No se pudo registrar el adjunto con este identificador"
                    )
                db.add(
                    Attachment(
                        **manifest.model_dump(),
                        order_id=order_id,
                        organization_id=principal.organization_id,
                    )
                )
        for previous in existing.values():
            if previous.id not in wanted and previous.deleted_at is None:
                previous.deleted_at = func.now()
        audit(db, principal, "order.updated", order_id)
        db.commit()
    except (IntegrityError, HTTPException) as error:
        db.rollback()
        if isinstance(error, HTTPException):
            raise
        if db.scalar(
            select(Order.id).where(
                Order.organization_id == principal.organization_id,
                Order.product_type == payload.product_type,
                Order.remission_number == remission,
                Order.deleted_at.is_(None),
                Order.id != order_id,
            )
        ):
            raise HTTPException(
                409, "Ya existe esa remisión en un pedido vigente de este producto"
            ) from None
        raise HTTPException(
            409, "El pedido o sus adjuntos cambiaron. Recarga antes de editar."
        ) from None
    db.expire_all()
    return order_by_id(db, principal, order_id)

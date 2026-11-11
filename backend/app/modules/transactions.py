"""Atomic business mutation + versioned audit + durable, replayable HTTP receipt."""

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, select

from app.persistence.models import (
    Attachment,
    AuditEvent,
    CarrotDetails,
    Customer,
    OperationReceipt,
    Order,
    Organization,
    Payment,
    PaymentAllocation,
    PaymentApplication,
    PotatoDetails,
    PotatoGradeLine,
)

BUSINESS_MODELS = (
    Customer,
    Order,
    CarrotDetails,
    PotatoDetails,
    PotatoGradeLine,
    Attachment,
    Payment,
    PaymentApplication,
    PaymentAllocation,
)


def utc_now():
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def encode(value):
    # Decimal must remain text, including amounts with more than 28 significant digits.
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return (
            value.replace(tzinfo=UTC).isoformat()
            if value.tzinfo is None
            else value.astimezone(UTC).isoformat()
        )
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(type(value).__name__)


def dumps(value):
    return json.dumps(value, default=encode, sort_keys=True, ensure_ascii=False, allow_nan=False)


def snapshot(db, organization_id):
    result = {}
    models = list(BUSINESS_MODELS)
    if db.bind.dialect.name == "sqlite":
        from app.local.models import CaptureStore, DocumentAction, LocalBlob

        for model in (LocalBlob, DocumentAction, CaptureStore):
            if inspect(db.connection()).has_table(model.__tablename__):
                models.append(model)
    for model in models:
        table = model.__table__
        rows = {}
        query = select(table)
        if "organization_id" in table.c:
            query = query.where(table.c.organization_id == organization_id)
        for row in db.execute(query).mappings():
            key = ":".join(str(row[column.name]) for column in table.primary_key)
            rows[key] = json.loads(dumps(dict(row)))
        result[table.name] = rows
    return result


def changes(before, after):
    previous, current = {}, {}
    for table in before:
        keys = set(before[table]) | set(after[table])
        for key in sorted(keys):
            old, new = before[table].get(key), after[table].get(key)
            if old != new:
                previous.setdefault(table, {})[key] = old
                current.setdefault(table, {})[key] = new
    return previous, current


def commit(db):
    if db.info.get("business_operation") is not None:
        db.flush()
    else:
        db.commit()


def audit(db, principal, action, record_id):
    context = db.info.get("business_operation")
    if context is not None:
        context["events"].append((action, record_id))
    else:
        # Legacy internal callers have no observed before/after context; do not invent it.
        db.add(
            AuditEvent(
                organization_id=principal.organization_id,
                actor_id=principal.user_id,
                action=action,
                record_id=record_id,
                schema_version=1,
            )
        )


def reserve_organization(db, organization_id):
    if db.bind.dialect.name == "sqlite" and not db.in_transaction():
        db.connection(execution_options={"sqlite_write": True})
    db.scalar(select(Organization).where(Organization.id == organization_id).with_for_update())


def execute(
    db,
    principal,
    request,
    action,
    record_id,
    payload,
    callback,
    response_model=None,
    status_code=200,
):
    body = dumps({"action": action, "record_id": record_id, "payload": payload})
    signature = hashlib.sha256(body.encode()).hexdigest()
    key = request.headers.get("Idempotency-Key")
    try:
        operation_id = (
            UUID(key)
            if key
            else uuid5(
                NAMESPACE_URL, f"{principal.organization_id}:{principal.user_id}:{signature}"
            )
        )
    except ValueError:
        raise HTTPException(422, "Idempotency-Key debe ser un UUID") from None
    # All new private writers acquire this same org lock. SQLite has BEGIN IMMEDIATE.
    reserve_organization(db, principal.organization_id)
    existing = db.get(OperationReceipt, (principal.organization_id, operation_id))
    if existing:
        if existing.actor_id != principal.user_id or existing.request_hash != signature:
            raise HTTPException(409, "Identificador de operación usado con otros datos o autor")
        response = json.loads(existing.response_json)
        if existing.outcome == "confirmed" and not action.endswith(".deleted"):
            # Preserve existing API semantics: replay proves the original commit,
            # while the resource response reflects its current version/status.
            from app.modules import operations, payments

            if action.startswith("customer."):
                response = response_model.model_validate(
                    operations.customer_by_id(db, principal, record_id)
                ).model_dump(mode="json")
            elif action.startswith("order."):
                response = operations.order_response(
                    db, principal, operations.order_by_id(db, principal, record_id)
                ).model_dump(mode="json")
            elif action.startswith("payment."):
                payment_id = UUID(payload["payment_id"]) if "payment_id" in payload else record_id
                response = payments.payment_response(
                    db, principal, payments.payment_by_id(db, principal, payment_id)
                )
                response = response_model.model_validate(response).model_dump(mode="json")
        return JSONResponse(
            response,
            status_code=existing.status_code,
            headers={
                "X-Operation-ID": str(operation_id),
                "X-Operation-Outcome": existing.outcome,
                "X-Operation-Replayed": "true",
            },
        )
    before = snapshot(db, principal.organization_id)
    context = {"events": [], "id": operation_id}
    db.info["business_operation"] = context
    outcome, rejection = "confirmed", None
    try:
        value = callback()
        db.flush()
        if response_model:
            value = response_model.model_validate(value).model_dump(mode="json")
        # Keep financial dictionaries exact; never use jsonable_encoder's float Decimal.
        else:
            value = json.loads(dumps(value))
        db.expire_all()
        after = snapshot(db, principal.organization_id)
        old, new = changes(before, after)
    except HTTPException as error:
        if error.status_code >= 500:
            db.rollback()
            raise
        # Some old service error handlers roll back their own transaction. No business
        # changes remain; reacquire the serialization lock before recording rejection.
        db.rollback()
        reserve_organization(db, principal.organization_id)
        existing = db.get(OperationReceipt, (principal.organization_id, operation_id))
        if existing:
            if existing.actor_id != principal.user_id or existing.request_hash != signature:
                raise HTTPException(
                    409, "Identificador de operación usado con otros datos o autor"
                ) from None
            return JSONResponse(
                json.loads(existing.response_json),
                status_code=existing.status_code,
                headers={
                    "X-Operation-ID": str(operation_id),
                    "X-Operation-Outcome": existing.outcome,
                },
            )
        if not key:
            # A known rejection is a completed attempt, not a reservation forever.
            # Legacy callers may retry after conditions change. Explicit keys replay it.
            operation_id = uuid4()
        outcome, status_code = "rejected", error.status_code
        value = {"detail": error.detail, "operation_id": str(operation_id), "outcome": outcome}
        old, new, rejection = {}, {}, str(error.detail)
        context["events"] = [(f"{action}.rejected", record_id)]
    except BaseException:
        db.rollback()
        raise
    finally:
        db.info.pop("business_operation", None)
    timestamp = utc_now()
    for event_action, identifier in context["events"]:
        db.add(
            AuditEvent(
                id=uuid4(),
                organization_id=principal.organization_id,
                actor_id=principal.user_id,
                action=event_action,
                record_id=identifier,
                schema_version=2,
                operation_id=operation_id,
                occurred_at_utc=timestamp,
                reason=payload.get("reason") or rejection,
                values_before=dumps(old),
                values_after=dumps(new),
            )
        )
    db.add(
        OperationReceipt(
            organization_id=principal.organization_id,
            id=operation_id,
            actor_id=principal.user_id,
            action=action,
            record_id=record_id,
            request_hash=signature,
            response_json=dumps(value),
            status_code=status_code,
            outcome=outcome,
            created_at_utc=timestamp,
        )
    )
    try:
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return JSONResponse(
        jsonable_encoder(value),
        status_code=status_code,
        headers={
            "X-Operation-ID": str(operation_id),
            "X-Operation-Outcome": outcome,
            "X-Operation-Replayed": "false",
        },
    )

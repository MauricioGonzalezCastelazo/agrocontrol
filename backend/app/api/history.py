import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.api.business import Admin, Current, Database
from app.persistence.models import AuditEvent, OperationReceipt

router = APIRouter(prefix="/api/v1", tags=["history"])


@router.get("/operations/{operation_id}")
def operation(operation_id: UUID, db: Database, principal: Current):
    receipt = db.get(OperationReceipt, (principal.organization_id, operation_id))
    if receipt is None or (
        receipt.actor_id != principal.user_id and principal.role != "administrator"
    ):
        raise HTTPException(
            404, "No hay comprobante visible de esta operación; su ausencia no confirma un rechazo"
        )
    return {
        "operation_id": receipt.id,
        "outcome": receipt.outcome,
        "status_code": receipt.status_code,
        "action": receipt.action,
        "record_id": receipt.record_id,
        "created_at_utc": receipt.created_at_utc,
        "response_at_confirmation": json.loads(receipt.response_json),
        "external_backup": "pending",
    }


@router.get("/audit-events")
def history(
    db: Database,
    principal: Admin,
    record_id: UUID | None = None,
    operation_id: UUID | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
):
    query = select(AuditEvent).where(AuditEvent.organization_id == principal.organization_id)
    if record_id:
        query = query.where(AuditEvent.record_id == record_id)
    if operation_id:
        query = query.where(AuditEvent.operation_id == operation_id)
    events = db.scalars(
        query.order_by(AuditEvent.created_at, AuditEvent.id).offset(offset).limit(limit)
    )
    return {
        "items": [
            {
                "id": event.id,
                "schema_version": event.schema_version,
                "action": event.action,
                "record_id": event.record_id,
                "author_id": event.actor_id,
                "operation_id": event.operation_id,
                "occurred_at_utc": event.occurred_at_utc,
                "historical_created_at": event.created_at if event.schema_version == 1 else None,
                "reason": event.reason,
                "values_before": json.loads(event.values_before) if event.values_before else None,
                "values_after": json.loads(event.values_after) if event.values_after else None,
            }
            for event in events
        ]
    }

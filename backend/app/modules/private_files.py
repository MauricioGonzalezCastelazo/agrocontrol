from pathlib import Path
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.dependencies import Principal
from app.core.config import get_settings
from app.modules.operations import audit, order_by_id
from app.persistence.models import Attachment, Order


def attachment_by_id(db: Session, principal: Principal, order_id: UUID, attachment_id: UUID):
    order_by_id(db, principal, order_id)
    attachment = db.scalar(
        select(Attachment).where(
            Attachment.id == attachment_id,
            Attachment.order_id == order_id,
            Attachment.organization_id == principal.organization_id,
        )
    )
    if attachment is None:
        raise HTTPException(404, "Archivo no disponible")
    if attachment.deleted_at is not None:
        raise HTTPException(410, "Este adjunto fue retirado del pedido")
    return attachment


def object_path(organization_id: UUID, order_id: UUID, attachment_id: UUID) -> Path:
    # Only UUIDs construct paths; user filenames never touch the filesystem.
    return (
        get_settings().private_files_path.resolve()
        / str(organization_id)
        / str(order_id)
        / str(attachment_id)
    )


def finish_upload(db: Session, principal: Principal, attachment: Attachment):
    # Serialize attachment completion with edits/deletion of the parent order.
    parent = db.execute(
        update(Order)
        .where(
            Order.id == attachment.order_id,
            Order.organization_id == principal.organization_id,
            Order.deleted_at.is_(None),
        )
        .values(updated_at=Order.updated_at)
        .execution_options(synchronize_session=False)
    )
    if parent.rowcount != 1:
        db.rollback()
        raise HTTPException(410, "Este pedido fue eliminado")
    result = db.execute(
        update(Attachment)
        .where(
            Attachment.id == attachment.id,
            Attachment.organization_id == principal.organization_id,
            Attachment.status == "pending",
            Attachment.deleted_at.is_(None),
        )
        .values(status="ready")
        .execution_options(synchronize_session=False)
    )
    if result.rowcount:
        db.execute(
            update(Order)
            .where(
                Order.id == attachment.order_id,
                Order.organization_id == principal.organization_id,
            )
            .values(version=Order.version + 1, updated_at=func.now(), updated_by=principal.user_id)
        )
        audit(db, principal, "attachment.uploaded", attachment.id)
    db.commit()
    db.refresh(attachment)
    if attachment.deleted_at is not None:
        raise HTTPException(410, "Este adjunto fue retirado del pedido")
    return attachment

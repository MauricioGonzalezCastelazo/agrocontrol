"""Read-only checks. Findings never repair, delete, or invent business values."""

import json
import time
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text

from app.domain.potato import calculate_potato
from app.local.files import verify_file
from app.local.models import CaptureStore, DocumentAction, LocalBlob, StorageIdentity
from app.local.preservation import utc_now
from app.modules.balances import add, order_paid, payment_applied, subtract
from app.modules.schemas import calculate_total
from app.persistence.models import (
    Attachment,
    CarrotDetails,
    Order,
    Payment,
    PaymentAllocation,
    PaymentApplication,
    PotatoDetails,
    PotatoGradeLine,
)


def documents(db, runtime):
    result, known = [], set()
    root = runtime.files
    for model, staged in ((Attachment, False), (LocalBlob, True)):
        for record in db.scalars(select(model)):
            if staged:
                relative = f"staged/{record.id}"
                ready = bool(record.ready)
            else:
                relative = f"{record.organization_id}/{record.order_id}/{record.id}"
                ready = record.status == "ready"
            path = root / relative
            known.add(relative)
            if path.is_symlink() or root not in path.resolve().parents:
                state = "unsafe_path"
            elif not path.is_file():
                state = "missing" if ready else "upload_pending"
            elif not verify_file(path, record.size_bytes, record.sha256):
                state = "corrupt"
            else:
                state = "verified" if ready else "awaiting_confirmation"
            result.append(
                {
                    "id": str(record.id),
                    "path": relative,
                    "state": state,
                    "staged": staged,
                    "retained": bool(getattr(record, "deleted_at", None)),
                    "order_id": None if staged else str(record.order_id),
                }
            )
    for action in db.scalars(select(DocumentAction)):
        for relative in (action.source_path, action.destination_path):
            if relative:
                known.add(relative)
                path = root / relative
                safe = root in path.resolve().parents and not path.is_symlink()
                state = (
                    "preserved_temporary"
                    if safe and verify_file(path, action.size_bytes, action.sha256)
                    else "preservation_file_missing_or_corrupt"
                )
                result.append({"path": relative, "state": state})
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            result.append({"path": relative, "state": "unsafe_path"})
        elif path.is_file() and relative not in known:
            temporary = False
            parts = path.name.split(".")
            if len(parts) == 3 and parts[2] == "part":
                try:
                    UUID(parts[0])
                    UUID(parts[1])
                    temporary = True
                except ValueError:
                    pass
            state = "unreferenced"
            if temporary:
                state = (
                    "abandoned_temporary"
                    if time.time() - path.stat().st_mtime >= 86400
                    else "recent_temporary"
                )
            result.append({"path": relative, "state": state})
    return result


def diagnose(db, runtime):
    findings = []

    def finding(category, code, identifier=None, **extra):
        findings.append(
            {
                "category": category,
                "code": code,
                "id": str(identifier) if identifier is not None else None,
                **extra,
            }
        )

    physical = list(db.scalars(text("PRAGMA integrity_check")))
    if physical != ["ok"]:
        finding("sqlite", "integrity_failed", details=physical)
    for row in db.execute(text("PRAGMA foreign_key_check")):
        finding("relationships", "foreign_key_failed", table=row[0], rowid=row[1])
    organization = runtime.principal.organization_id
    orders = list(db.scalars(select(Order).where(Order.organization_id == organization)))
    receipts = list(db.scalars(select(Payment).where(Payment.organization_id == organization)))
    seen = set()
    for order in orders:
        try:
            carrot = db.get(CarrotDetails, order.id)
            potato = db.get(PotatoDetails, order.id)
            if bool(carrot) == bool(potato) or (order.product_type == "carrot") != bool(carrot):
                raise ValueError("Inconsistent product details")
            if carrot:
                calculated = calculate_total(carrot.hectares, carrot.unit_price)
            else:
                lines = list(
                    db.scalars(select(PotatoGradeLine).where(PotatoGradeLine.order_id == order.id))
                )
                calculated = Decimal(
                    calculate_potato(
                        {
                            "gross_weight": potato.gross_weight,
                            "tare_weight": potato.tare_weight,
                            "additional_shrinkage": potato.additional_shrinkage,
                            "shrinkage_override": potato.shrinkage_override,
                            "lines": [
                                {
                                    "grade_code": line.grade_code,
                                    "quantity": line.quantity,
                                    "unit_price": line.unit_price,
                                }
                                for line in lines
                            ],
                        },
                        version=potato.calculation_version,
                    )["total_amount"]
                )
            if calculated != order.total_amount:
                finding(
                    "calculations",
                    "order_total_mismatch",
                    order.id,
                    stored=format(order.total_amount, ".8f"),
                    calculated=format(calculated, ".8f"),
                )
            paid = order_paid(db, order.id)
            if paid < 0 or paid > order.total_amount or (order.deleted_at and paid):
                finding("balances", "invalid_order_balance", order.id)
            if paid and order.remission_number is None:
                finding("remissions", "paid_order_without_remission", order.id)
            if order.deleted_at is None and order.remission_number is not None:
                key = (order.product_type, order.remission_number)
                if key in seen:
                    finding("remissions", "duplicate_active_remission", order.id)
                seen.add(key)
        except Exception as error:
            finding("calculations", "order_check_failed", order.id, error_type=type(error).__name__)
    for payment in receipts:
        applied = payment_applied(db, payment.id)
        if applied < 0 or applied > payment.amount or (payment.voided_at and applied):
            finding("balances", "invalid_payment_balance", payment.id)
    for allocation, application, payment, order in db.execute(
        select(PaymentAllocation, PaymentApplication, Payment, Order)
        .join(PaymentApplication, PaymentApplication.id == PaymentAllocation.application_id)
        .join(Payment, Payment.id == PaymentApplication.payment_id)
        .join(Order, Order.id == PaymentAllocation.order_id)
        .where(PaymentAllocation.organization_id == organization)
    ):
        if (
            payment.customer_id != order.customer_id
            or len(
                {
                    allocation.organization_id,
                    application.organization_id,
                    payment.organization_id,
                    order.organization_id,
                }
            )
            != 1
        ):
            finding("relationships", "allocation_customer_or_organization_mismatch", application.id)
    customers = {order.customer_id for order in orders} | {
        payment.customer_id for payment in receipts
    }
    for customer in customers:
        received = add(
            payment.amount
            for payment in receipts
            if payment.customer_id == customer and not payment.voided_at
        )
        paid = add(order_paid(db, order.id) for order in orders if order.customer_id == customer)
        credit = add(
            subtract(payment.amount, payment_applied(db, payment.id))
            for payment in receipts
            if payment.customer_id == customer and not payment.voided_at
        )
        if received != add([paid, credit]):
            finding("balances", "customer_reconciliation_mismatch", customer)
    try:
        store = json.loads(db.get(CaptureStore, 1).data)
        for draft in store["drafts"]:
            original = {
                item["id"] for item in (draft.get("baseOrder") or {}).get("attachments", [])
            }
            for manifest in draft["payload"]["attachments"]:
                if manifest["id"] not in original and db.get(LocalBlob, manifest["id"]) is None:
                    finding("documents", "capture_original_missing", manifest["id"])
    except Exception as error:
        finding("captures", "capture_store_invalid", error_type=type(error).__name__)
    inventory = documents(db, runtime)
    for item in inventory:
        if item["state"] not in ("verified", "recent_temporary", "preserved_temporary"):
            finding("documents", item["state"], item.get("id"), path=item["path"])
    identity = db.get(StorageIdentity, 1)
    return {
        "report_version": 1,
        "checked_at_utc": utc_now(),
        "ok": not findings,
        "findings": findings,
        "documents": inventory,
        "counts": {"orders": len(orders), "payments": len(receipts)},
        "preservation": {
            "installation_id": identity.installation_id,
            "metadata_created_at_utc": identity.metadata_created_at_utc,
            "manifest_format_version": identity.manifest_format_version,
            "schema_revision": db.scalar(text("SELECT version_num FROM alembic_version")),
            "external_backup": identity.external_backup_state,
        },
    }

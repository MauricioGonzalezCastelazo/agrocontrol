"""Conservative reconciliation: confirm verified files, copy old temporaries, never purge."""

from uuid import UUID, uuid4

from app.local.diagnostics import diagnose, documents
from app.local.files import validate_type, verify_file
from app.local.models import DocumentAction, LocalBlob
from app.local.preservation import copy_exclusive, file_hash, utc_now
from app.modules.private_files import finish_upload
from app.modules.transactions import audit
from app.persistence.models import Attachment


def reconcile(db, principal, runtime, payload):
    inventory = documents(db, runtime)
    confirmed, preserved = 0, 0
    operation_id = str(db.info["business_operation"]["id"])
    for item in inventory:
        path = runtime.files / item["path"]
        if item["state"] == "awaiting_confirmation" and not item["retained"]:
            if item["staged"]:
                record = db.get(LocalBlob, item["id"])
                validate_type(path, record.filename)
                record.ready = 1
            else:
                record = db.get(Attachment, UUID(item["id"]))
                from app.persistence.models import Order

                if db.get(Order, record.order_id).deleted_at is not None:
                    continue
                validate_type(path, record.filename)
                finish_upload(db, principal, record)
            confirmed += 1
        elif item["state"] == "abandoned_temporary" and payload.preserve_temporaries:
            # Retain the original even if the copy succeeds. No moves, deletion,
            # replacement, or heuristic assignment of these bytes to a business file.
            relative = f"quarantine/{operation_id}/{uuid4().hex}.bin"
            target = runtime.files / relative
            copy_exclusive(path, target)
            digest, size = file_hash(target), target.stat().st_size
            if not verify_file(path, size, digest):
                raise OSError("Temporary changed while preserving it; original retained")
            db.add(
                DocumentAction(
                    id=str(uuid4()),
                    operation_id=operation_id,
                    source_path=item["path"],
                    destination_path=relative,
                    size_bytes=size,
                    sha256=digest,
                    reason=payload.reason,
                    created_at_utc=utc_now(),
                )
            )
            preserved += 1
    if confirmed or preserved:
        audit(db, principal, "documents.reconciled", principal.organization_id)
    db.flush()
    return {
        "confirmed_documents": confirmed,
        "preserved_temporaries": preserved,
        "deleted_files": 0,
        "external_backup": "pending",
        "diagnostics": diagnose(db, runtime),
    }

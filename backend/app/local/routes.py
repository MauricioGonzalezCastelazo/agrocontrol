import hashlib
import json
from typing import Any
from uuid import UUID, uuid4

import anyio
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import update
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from app.api.business import Admin, Current, Database
from app.domain.attachments import allowed_filename
from app.local.database import runtime_info
from app.local.diagnostics import diagnose
from app.local.files import durable_replace, validate_type, verify_file
from app.local.models import CaptureStore, LocalBlob
from app.local.reconciliation import reconcile
from app.modules.operations import audit
from app.modules.schemas import AttachmentInput, DeleteReason
from app.modules.transactions import commit, execute

router = APIRouter(prefix="/api/v1/local", tags=["local"])


@router.get("/diagnostics")
def diagnostics(request: Request, db: Database, principal: Admin):
    return diagnose(db, request.app.state.local_runtime)


class ReconcileInput(DeleteReason):
    preserve_temporaries: bool = True


@router.post("/documents/reconcile")
def reconcile_files(payload: ReconcileInput, request: Request, db: Database, principal: Admin):
    if not payload.reason.strip():
        raise HTTPException(422, "Escribe el motivo de la conciliación")
    try:
        return execute(
            db,
            principal,
            request,
            "documents.reconciled",
            principal.organization_id,
            payload.model_dump(),
            lambda: reconcile(db, principal, request.app.state.local_runtime, payload),
        )
    except OSError:
        raise HTTPException(
            503,
            "No se pudo confirmar la conciliación. Se conservan los originales; "
            "reintenta con los mismos datos.",
            headers={"X-Operation-Outcome": "uncertain"},
        ) from None


class Bootstrap(BaseModel):
    token: str = Field(min_length=32, max_length=200)


def session_payload(runtime, csrf):
    return {"principal": runtime.principal, "csrf": csrf}


@router.post("/bootstrap")
def bootstrap(payload: Bootstrap, request: Request, response: Response):
    runtime = request.app.state.local_runtime
    exchanged = runtime.exchange(payload.token)
    if exchanged is None:
        raise HTTPException(
            401, "El enlace de inicio venció o ya fue utilizado. Reinicia AgroControl."
        )
    cookie, csrf = exchanged
    response.set_cookie("agrocontrol_local", cookie, httponly=True, samesite="strict", path="/")
    response.headers["Cache-Control"] = "no-store"
    return session_payload(runtime, csrf)


@router.get("/session")
def session(request: Request):
    runtime = request.app.state.local_runtime
    return session_payload(runtime, runtime.session(request.cookies.get("agrocontrol_local")))


@router.get("/status")
def status(request: Request, db: Database, principal: Current):
    return request.app.state.local_runtime.status(db) | runtime_info()


@router.get("/store")
def get_store(db: Database, principal: Current):
    store = db.get(CaptureStore, 1)
    data = json.loads(store.data)
    # Recover uploads durably staged before a crash interrupted the capture CAS.
    known = {row["manifest"]["id"] for row in data["files"]}
    scope = f"{principal.organization_id}:{principal.user_id}"
    for draft in data["drafts"]:
        original = {file["id"] for file in (draft.get("baseOrder") or {}).get("attachments", [])}
        for manifest in draft["payload"]["attachments"]:
            if manifest["id"] in known or manifest["id"] in original:
                continue
            blob = db.get(LocalBlob, manifest["id"])
            if (
                blob
                and blob.ready
                and all(
                    manifest.get(key) == getattr(blob, key)
                    for key in ("id", "filename", "sha256", "size_bytes")
                )
            ):
                data["files"].append(
                    {
                        "key": f"{scope}:{blob.id}",
                        "scope": scope,
                        "orderId": draft["orderId"],
                        "manifest": manifest,
                        "blob": {"localBlob": blob.id},
                    }
                )
                known.add(blob.id)
    return {"revision": store.revision, "data": data}


class StoreInput(BaseModel):
    revision: int = Field(ge=0)
    data: dict[str, list[dict[str, Any]]]


@router.put("/store")
def put_store(payload: StoreInput, request: Request, db: Database, principal: Current):
    return execute(
        db,
        principal,
        request,
        "local.captures_saved",
        principal.organization_id,
        payload.model_dump(),
        lambda: save_store(payload, db, principal),
    )


def save_store(payload, db, principal):
    encoded = json.dumps(payload.data, ensure_ascii=False, allow_nan=False)
    if (
        set(payload.data) != {"files", "drafts", "payments"}
        or len(encoded.encode()) > 8 * 1024 * 1024
    ):
        raise HTTPException(422, "La cola de capturas supera el límite permitido")
    scope = f"{principal.organization_id}:{principal.user_id}"
    for name, rows in payload.data.items():
        if len(rows) > 10000 or len({row.get("key") for row in rows}) != len(rows):
            raise HTTPException(422, "Capturas duplicadas o límite excedido")
        for row in rows:
            if row.get("scope") != scope or not str(row.get("key", "")).startswith(f"{scope}:"):
                raise HTTPException(403, "La captura pertenece a otro espacio")
            if name == "files":
                blob = db.get(LocalBlob, row.get("blob", {}).get("localBlob", ""))
                if blob is None or not blob.ready:
                    raise HTTPException(409, "Un documento todavía no se guardó en disco")
                manifest = row.get("manifest", {})
                if any(
                    manifest.get(key) != getattr(blob, key)
                    for key in ("id", "filename", "sha256", "size_bytes")
                ):
                    raise HTTPException(409, "El documento cambió respecto a su captura")
    changed = db.execute(
        update(CaptureStore)
        .where(CaptureStore.id == 1, CaptureStore.revision == payload.revision)
        .values(data=encoded, revision=CaptureStore.revision + 1)
    )
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Las capturas cambiaron en otra pestaña. Reintenta la operación.")
    audit(db, principal, "local.captures_saved", principal.organization_id)
    commit(db)
    return {"revision": payload.revision + 1, "data": payload.data}


@router.post("/blobs")
def register_blob(payload: AttachmentInput, request: Request, db: Database, principal: Current):
    return execute(
        db,
        principal,
        request,
        "local.blob_registered",
        payload.id,
        payload.model_dump(mode="json"),
        lambda: register_blob_values(payload, db, principal),
    )


def register_blob_values(payload, db, principal):
    if not allowed_filename(payload.filename):
        raise HTTPException(422, "Formato de archivo no permitido")
    existing = db.get(LocalBlob, str(payload.id))
    values = payload.model_dump(mode="json")
    if existing:
        if any(getattr(existing, key) != value for key, value in values.items()):
            raise HTTPException(409, "Este identificador corresponde a otro documento")
    else:
        db.add(LocalBlob(**values, ready=0))
        audit(db, principal, "local.blob_registered", payload.id)
        commit(db)
    return values


def blob_record(db, identifier):
    row = db.get(LocalBlob, str(identifier))
    if row is None:
        raise HTTPException(404, "Documento no disponible")
    return row


def confirm_blob(db, principal, request, row):
    def confirm():
        if not row.ready:
            row.ready = 1
            audit(db, principal, "local.blob_confirmed", UUID(row.id))
        commit(db)
        return {"ready": True}

    return execute(
        db,
        principal,
        request,
        "local.blob_confirmed",
        UUID(row.id),
        {"sha256": row.sha256, "size_bytes": row.size_bytes},
        confirm,
    )


@router.put("/blobs/{identifier}")
async def upload_blob(identifier: UUID, request: Request, db: Database, principal: Current):
    row = await run_in_threadpool(blob_record, db, identifier)
    target = request.app.state.local_runtime.files / "staged" / str(identifier)
    if await run_in_threadpool(verify_file, target, row.size_bytes, row.sha256):
        return await run_in_threadpool(confirm_blob, db, principal, request, row)
    temporary = target.with_name(f"{identifier}.{uuid4()}.part")
    count, digest = 0, hashlib.sha256()
    try:
        await run_in_threadpool(target.parent.mkdir, parents=True, exist_ok=True, mode=0o700)
        async with await anyio.open_file(temporary, "xb") as output:
            async for chunk in request.stream():
                count += len(chunk)
                if count > row.size_bytes:
                    raise HTTPException(413, "El archivo excede el tamaño registrado")
                digest.update(chunk)
                await output.write(chunk)
        if count != row.size_bytes or digest.hexdigest() != row.sha256:
            raise HTTPException(422, "El archivo no coincide con el original")
        await run_in_threadpool(validate_type, temporary, row.filename)
        await run_in_threadpool(durable_replace, temporary, target)
        return await run_in_threadpool(confirm_blob, db, principal, request, row)
    except ClientDisconnect:
        raise HTTPException(400, "Subida interrumpida; conserva el original y reintenta") from None
    except OSError:
        raise HTTPException(503, "No se pudo guardar el archivo en disco") from None
    finally:
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(temporary.unlink, missing_ok=True)


@router.get("/blobs/{identifier}")
def download_blob(identifier: UUID, request: Request, db: Database, principal: Current):
    row = blob_record(db, identifier)
    path = request.app.state.local_runtime.files / "staged" / str(identifier)
    if not row.ready or not verify_file(path, row.size_bytes, row.sha256):
        raise HTTPException(503, "El archivo requiere revisión; conserva el original")
    return FileResponse(path, media_type="application/octet-stream", filename=row.filename)

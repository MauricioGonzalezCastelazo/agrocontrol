import hashlib
import os
from uuid import UUID, uuid4

import anyio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from app.api.business import Current, Database
from app.core.config import get_settings
from app.domain.attachments import allowed_filename
from app.modules.private_files import attachment_by_id, finish_upload, object_path
from app.modules.schemas import AttachmentResponse
from app.modules.transactions import execute

router = APIRouter(prefix="/api/v1/orders", tags=["attachments"])


def confirm_upload(db, principal, request, attachment):
    return execute(
        db,
        principal,
        request,
        "attachment.uploaded",
        attachment.id,
        {
            "order_id": str(attachment.order_id),
            "sha256": attachment.sha256,
            "size_bytes": attachment.size_bytes,
        },
        lambda: finish_upload(db, principal, attachment),
        AttachmentResponse,
    )


@router.put("/{order_id}/attachments/{attachment_id}", response_model=AttachmentResponse)
async def upload(
    order_id: UUID, attachment_id: UUID, request: Request, db: Database, principal: Current
):
    attachment = await run_in_threadpool(attachment_by_id, db, principal, order_id, attachment_id)
    local = getattr(request.app.state, "local_runtime", None) is not None
    destination = object_path(
        principal.organization_id,
        order_id,
        attachment_id,
        getattr(request.app.state, "private_files_path", None),
    )
    if attachment.status == "ready" and destination.is_file():
        if not local:
            return await run_in_threadpool(confirm_upload, db, principal, request, attachment)
        from app.local.files import verify_file

        if await run_in_threadpool(
            verify_file, destination, attachment.size_bytes, attachment.sha256
        ):
            return await run_in_threadpool(confirm_upload, db, principal, request, attachment)
    if not allowed_filename(attachment.filename):
        raise HTTPException(422, "Formato de archivo no permitido para nuevas subidas")
    if length := request.headers.get("content-length"):
        try:
            if int(length) != attachment.size_bytes:
                raise ValueError
        except ValueError:
            raise HTTPException(422, "El tamaño no coincide con el archivo registrado") from None
    temporary = destination.with_name(f"{attachment_id}.{uuid4()}.part")
    count = 0
    digest = hashlib.sha256()
    try:
        await run_in_threadpool(destination.parent.mkdir, parents=True, exist_ok=True, mode=0o700)
        async with await anyio.open_file(temporary, "xb") as target:
            async for chunk in request.stream():
                count += len(chunk)
                if count > min(attachment.size_bytes, get_settings().max_attachment_bytes):
                    raise HTTPException(413, "El archivo excede el tamaño registrado")
                digest.update(chunk)
                await target.write(chunk)
        if count != attachment.size_bytes or digest.hexdigest() != attachment.sha256:
            raise HTTPException(422, "El archivo no coincide. Selecciona el archivo original.")
        if local:
            from app.local.files import durable_replace, validate_type

            await run_in_threadpool(validate_type, temporary, attachment.filename)
            await run_in_threadpool(durable_replace, temporary, destination)
        else:
            await run_in_threadpool(os.replace, temporary, destination)
        return await run_in_threadpool(confirm_upload, db, principal, request, attachment)
    except ClientDisconnect:
        raise HTTPException(400, "La subida se interrumpió. Puedes reintentar.") from None
    except OSError:
        raise HTTPException(503, "No se pudo almacenar el archivo. Puedes reintentar.") from None
    finally:
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(temporary.unlink, missing_ok=True)


@router.get("/{order_id}/attachments/{attachment_id}/download")
def download(
    order_id: UUID, attachment_id: UUID, request: Request, db: Database, principal: Current
):
    attachment = attachment_by_id(db, principal, order_id, attachment_id)
    path = object_path(
        principal.organization_id,
        order_id,
        attachment_id,
        getattr(request.app.state, "private_files_path", None),
    )
    if attachment.status != "ready" or not path.is_file():
        raise HTTPException(404, "Archivo pendiente de subir o no disponible")
    if getattr(request.app.state, "local_runtime", None) is not None:
        from app.local.files import verify_file

        if not verify_file(path, attachment.size_bytes, attachment.sha256):
            raise HTTPException(503, "El archivo requiere revisión; conserva el original")
    # Every file type is treated as opaque bytes. Never render HTML, SVG, Office or executables.
    return FileResponse(
        path,
        filename=attachment.filename,
        media_type="application/octet-stream",
        content_disposition_type="attachment",
    )

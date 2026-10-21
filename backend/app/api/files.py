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

router = APIRouter(prefix="/api/v1/orders", tags=["attachments"])


@router.put("/{order_id}/attachments/{attachment_id}", response_model=AttachmentResponse)
async def upload(
    order_id: UUID, attachment_id: UUID, request: Request, db: Database, principal: Current
):
    attachment = await run_in_threadpool(attachment_by_id, db, principal, order_id, attachment_id)
    destination = object_path(principal.organization_id, order_id, attachment_id)
    if attachment.status == "ready" and destination.is_file():
        return AttachmentResponse.model_validate(attachment)
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
        await run_in_threadpool(os.replace, temporary, destination)
        result = await run_in_threadpool(finish_upload, db, principal, attachment)
        return AttachmentResponse.model_validate(result)
    except ClientDisconnect:
        raise HTTPException(400, "La subida se interrumpió. Puedes reintentar.") from None
    except OSError:
        raise HTTPException(503, "No se pudo almacenar el archivo. Puedes reintentar.") from None
    finally:
        with anyio.CancelScope(shield=True):
            await run_in_threadpool(temporary.unlink, missing_ok=True)


@router.get("/{order_id}/attachments/{attachment_id}/download")
def download(order_id: UUID, attachment_id: UUID, db: Database, principal: Current):
    attachment = attachment_by_id(db, principal, order_id, attachment_id)
    path = object_path(principal.organization_id, order_id, attachment_id)
    if attachment.status != "ready" or not path.is_file():
        raise HTTPException(404, "Archivo pendiente de subir o no disponible")
    # Every file type is treated as opaque bytes. Never render HTML, SVG, Office or executables.
    return FileResponse(
        path,
        filename=attachment.filename,
        media_type="application/octet-stream",
        content_disposition_type="attachment",
    )

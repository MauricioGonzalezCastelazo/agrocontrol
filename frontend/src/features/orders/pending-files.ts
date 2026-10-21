import { synchronizePayments } from '../payments/payment-drafts'
import Dexie, { type EntityTable } from 'dexie'
import type { Principal } from '../../lib/api'
import {
  request,
  type Attachment,
  type AttachmentManifest,
  type CreateOrder,
  type Order,
  type UpdateOrder,
} from '../../lib/business-api'
import { ApiError } from '../../lib/api-error'
import { allowedFilename } from '../../lib/attachment-policy'

export type SelectedFile = { manifest: AttachmentManifest; blob: File }
type PendingFile = SelectedFile & { key: string; scope: string; orderId: string }
export type PendingDraft = {
  key: string
  scope: string
  orderId: string
  payload: CreateOrder | UpdateOrder
  operation?: 'create' | 'update'
  attempted?: boolean
  customerName?: string
  baseOrder?: Order
  lastStatus?: number
  lastError?: string
  createdAt: string
}
const database = new Dexie('agrocontrol-pending-attachments') as Dexie & {
  files: EntityTable<PendingFile, 'key'>
  drafts: EntityTable<PendingDraft, 'key'>
}
database.version(1).stores({ files: 'key, scope, [scope+orderId]' })
database.version(2).stores({ drafts: 'key, scope' })
function scope(principal: Principal) {
  return `${principal.organization_id}:${principal.user_id}`
}

export async function prepareFiles(files: File[]): Promise<SelectedFile[]> {
  const selected: SelectedFile[] = []
  for (const blob of files) {
    if (blob.size === 0 || blob.size > 25 * 1024 * 1024)
      throw new Error('Cada archivo debe ocupar entre 1 byte y 25 MB.')
    const filename = blob.name.trim()
    if (!allowedFilename(filename))
      throw new Error(
        'Formato no permitido. Selecciona una imagen o documento de la lista admitida.',
      )
    if (!filename || filename.length > 200 || /[\p{C}/\\]/u.test(filename))
      throw new Error(
        'Usa nombres de archivo de hasta 200 caracteres, sin barras ni caracteres de control.',
      )
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    const sha256 = Array.from(new Uint8Array(digest))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
    selected.push({
      blob,
      manifest: { id: crypto.randomUUID(), filename, size_bytes: blob.size, sha256 },
    })
  }
  return selected
}

export async function retainFiles(principal: Principal, orderId: string, files: SelectedFile[]) {
  await database.files.bulkPut(
    files.map((file) => ({
      ...file,
      key: `${scope(principal)}:${file.manifest.id}`,
      scope: scope(principal),
      orderId,
    })),
  )
}
export async function uploadRetained(principal: Principal, orderId: string) {
  const pending = await database.files
    .where('[scope+orderId]')
    .equals([scope(principal), orderId])
    .toArray()
  let failures = 0
  for (const file of pending) {
    try {
      await request<Attachment>(`/orders/${orderId}/attachments/${file.manifest.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file.blob,
      })
      await database.files.delete(file.key)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 410) {
        await database.files.delete(file.key)
        continue
      }
      failures++
    }
  }
  return failures
}
export async function pendingFileCount(principal: Principal) {
  return database.files.where('scope').equals(scope(principal)).count()
}

export async function retainDraft(
  principal: Principal,
  payload: CreateOrder | UpdateOrder,
  files: SelectedFile[],
  updateId?: string,
  metadata?: { customerName?: string; baseOrder?: Order },
) {
  const orderId = 'id' in payload ? payload.id : updateId
  if (!orderId) throw new Error('Falta el identificador del pedido.')
  const draft: PendingDraft = {
    key: `${scope(principal)}:${orderId}`,
    scope: scope(principal),
    orderId,
    operation: 'id' in payload ? 'create' : 'update',
    payload,
    createdAt: new Date().toISOString(),
    attempted: false,
    ...metadata,
  }
  await database.transaction('rw', database.files, database.drafts, async () => {
    const previous = await database.drafts.get(draft.key)
    if (
      previous?.attempted !== false &&
      previous &&
      JSON.stringify(previous.payload) !== JSON.stringify(payload)
    )
      throw new ApiError(
        409,
        'Esta captura ya se intentó enviar. Confirma su estado antes de cambiarla.',
      )
    if (previous) draft.attempted = previous.attempted ?? true
    await retainFiles(principal, orderId, files)
    const wanted = new Set(payload.attachments.map((file) => file.id))
    await database.files
      .where('[scope+orderId]')
      .equals([scope(principal), orderId])
      .filter((file) => !wanted.has(file.manifest.id))
      .delete()
    await database.drafts.put(draft)
  })
  return draft
}
export async function commitDraft(principal: Principal, draft: PendingDraft) {
  if (draft.scope !== scope(principal)) throw new Error('Este envío pertenece a otra sesión.')
  await database.transaction('rw', database.drafts, async () => {
    const current = await database.drafts.get(draft.key)
    if (!current || JSON.stringify(current.payload) !== JSON.stringify(draft.payload))
      throw new ApiError(
        409,
        'La captura cambió en otra pestaña. Vuelve a abrirla antes de enviar.',
      )
    await database.drafts.update(draft.key, { attempted: true })
  })
  let order: Order
  try {
    order = await request<Order>(
      draft.operation === 'update' ? `/orders/${draft.orderId}` : '/orders',
      {
        method: draft.operation === 'update' ? 'PATCH' : 'POST',
        body: JSON.stringify(draft.payload),
      },
      principal,
    )
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 410)
      await discardPendingOrder(principal, draft.orderId)
    else
      await database.drafts.update(draft.key, {
        lastStatus: cause instanceof ApiError ? cause.status : undefined,
        lastError: cause instanceof Error ? cause.message : 'No se pudo confirmar el envío.',
      })
    throw cause
  }
  await database.drafts.delete(draft.key)
  // Removed attachments must never remain queued for upload.
  const keep = new Set(order.attachments.map((file) => file.id))
  await database.files
    .where('[scope+orderId]')
    .equals([scope(principal), order.id])
    .filter((file) => !keep.has(file.manifest.id))
    .delete()
  const failures = await uploadRetained(principal, order.id)
  return { order, failures }
}

export async function getPendingDraft(principal: Principal, orderId: string) {
  return database.drafts.get(`${scope(principal)}:${orderId}`)
}

export async function reopenOrderCreation(principal: Principal, draft: PendingDraft) {
  if (draft.scope !== scope(principal) || draft.operation === 'update')
    throw new Error('Esta captura no corresponde a un pedido nuevo de tu cuenta.')
  try {
    await request<Order>(`/orders/${draft.orderId}`, { cache: 'reload' }, principal)
    throw new Error(
      'El pedido ya existe. Reintenta el guardado con los datos originales para confirmarlo.',
    )
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 404) throw cause
  }
  await database.transaction('rw', database.drafts, async () => {
    const current = await database.drafts.get(draft.key)
    if (!current || JSON.stringify(current.payload) !== JSON.stringify(draft.payload))
      throw new Error('La captura cambió. Vuelve a abrirla antes de corregirla.')
    await database.drafts.update(draft.key, {
      attempted: false,
      lastStatus: undefined,
      lastError: undefined,
    })
  })
}
export async function getRetainedFiles(principal: Principal, orderId: string) {
  return database.files
    .where('[scope+orderId]')
    .equals([scope(principal), orderId])
    .toArray()
}

export async function resolvePendingConflict(
  principal: Principal,
  draft: PendingDraft,
  server: Order,
  keepLocal: boolean,
) {
  if (
    draft.scope !== scope(principal) ||
    draft.operation !== 'update' ||
    server.id !== draft.orderId
  )
    throw new Error('La captura no corresponde a este pedido.')
  let resolved: PendingDraft | undefined
  await database.transaction('rw', database.drafts, database.files, async () => {
    const current = await database.drafts.get(draft.key)
    if (
      !current ||
      current.lastStatus !== 409 ||
      JSON.stringify(current.payload) !== JSON.stringify(draft.payload)
    )
      throw new Error('La captura cambió. Vuelve a abrir la comparación.')
    if (keepLocal) {
      resolved = {
        ...current,
        payload: { ...current.payload, expected_version: server.version },
        attempted: false,
        lastStatus: undefined,
        lastError: undefined,
        baseOrder: server,
      }
      await database.drafts.put(resolved)
    } else {
      await database.drafts.delete(draft.key)
      const keep = new Set(server.attachments.map((file) => file.id))
      await database.files
        .where('[scope+orderId]')
        .equals([scope(principal), server.id])
        .filter((file) => !keep.has(file.manifest.id))
        .delete()
    }
  })
  return resolved
}

let synchronization: Promise<number> | undefined
export function synchronizePending(principal: Principal): Promise<number> {
  if (synchronization) return synchronization
  synchronization = (async () => {
    let failures = 0
    const pending = await listPending(principal)
    for (const draft of pending.drafts) {
      try {
        failures += (await commitDraft(principal, draft)).failures
      } catch {
        failures++
      }
    }
    for (const id of pending.orderIds) failures += await uploadRetained(principal, id)
    failures += await synchronizePayments(principal)
    return failures
  })().finally(() => {
    synchronization = undefined
  })
  return synchronization
}

export async function discardPendingOrder(principal: Principal, orderId: string) {
  await database.transaction('rw', database.files, database.drafts, async () => {
    await database.drafts.delete(`${scope(principal)}:${orderId}`)
    await database.files
      .where('[scope+orderId]')
      .equals([scope(principal), orderId])
      .delete()
  })
}
export async function listPending(principal: Principal) {
  return {
    drafts: await database.drafts.where('scope').equals(scope(principal)).toArray(),
    orderIds: [
      ...new Set(
        (await database.files.where('scope').equals(scope(principal)).toArray()).map(
          (file) => file.orderId,
        ),
      ),
    ],
  }
}

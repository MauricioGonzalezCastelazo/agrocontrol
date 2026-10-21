import { accessToken } from '../features/auth/AuthProvider'
import { env, localWorkspace } from './env'
import { ApiError } from './api-error'
import type { PotatoCalculation, PotatoInput } from '../features/orders/potato-domain'
import { scopeKey, verifiedScope } from './session-scope'
import type { Principal } from './api'

export type Customer = {
  id: string
  name: string
  active: boolean
  notes: string | null
  version: number
  created_at: string
  updated_at: string
}
export type AttachmentManifest = {
  id: string
  filename: string
  size_bytes: number
  sha256: string
}
export type Attachment = AttachmentManifest & { status: 'pending' | 'ready' }
type OrderBase = {
  id: string
  customer_id: string
  customer_name: string
  remission_number?: number | null
  total_paid?: string
  remaining_amount?: string
  payment_status?: 'unpaid' | 'partial' | 'paid'
  order_date: string
  currency: 'MXN'
  description: string | null
  total_amount: string
  created_by: string
  created_at: string
  updated_at?: string
  updated_by?: string | null
  version: number
  attachments: Attachment[]
  attachment_status: 'complete' | 'pending'
}
export type Order = OrderBase &
  (
    | { product_type: 'carrot'; hectares: string; unit_price: string; potato?: null }
    | { product_type: 'potato'; hectares: null; unit_price: null; potato: PotatoCalculation }
  )
export type OrderFields = {
  customer_id: string
  remission_number?: number | null
  order_date: string
  description: string | null
  attachments: AttachmentManifest[]
} & (
  | { product_type: 'carrot'; details: { hectares: string; unit_price: string } }
  | { product_type: 'potato'; details: PotatoInput }
)
export type CreateOrder = OrderFields & { id: string }
export type Page<T> = { items: T[]; total: number }
export type UpdateOrder = OrderFields & { expected_version: number }

export async function request<T>(
  path: string,
  options: RequestInit = {},
  expectedPrincipal?: Principal,
): Promise<T> {
  if (import.meta.env.DEV && localWorkspace) {
    const { localRequest } = await import('./local-workspace')
    return localRequest<T>(path, options)
  }
  const isRead = !options.method || options.method === 'GET'
  const allowCached = options.cache !== 'reload'
  if (isRead && !navigator.onLine && !allowCached)
    throw new Error('Conecta para consultar la versión actual del servidor.')
  if (isRead && !navigator.onLine) return (await import('./private-cache')).cachedPrivate<T>(path)
  const token = await accessToken()
  const authorization = verifiedScope()
  if (
    expectedPrincipal &&
    (!authorization || scopeKey(authorization.principal) !== scopeKey(expectedPrincipal))
  )
    throw new ApiError(401, 'La sesión cambió. Abre la captura con la cuenta que la registró.')
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-Organization-ID', env.organizationId)
  if (typeof options.body === 'string') headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${env.apiUrl}${path}`, { ...options, headers, cache: 'no-store' })
  } catch (cause) {
    if (isRead && allowCached && cause instanceof TypeError)
      return (await import('./private-cache')).cachedPrivate<T>(path)
    throw cause
  }
  if (!response.ok) {
    if ([404, 410].includes(response.status))
      await (await import('./private-cache')).forgetPrivate(path).catch(() => undefined)
    const payload = await response.json().catch(() => ({}))
    const message =
      typeof payload.detail === 'string'
        ? payload.detail
        : response.status === 422
          ? 'Revisa los campos, los decimales permitidos y los límites de los archivos.'
          : 'No pudimos completar la operación. Revisa tu conexión y vuelve a intentar.'
    throw new ApiError(
      response.status,
      response.status === 401 ? 'Tu sesión venció. Vuelve a ingresar.' : message,
    )
  }
  const value = (await response.json()) as T
  if (!authorization || authorization !== verifiedScope())
    throw new ApiError(401, 'La sesión cambió o venció. Vuelve a ingresar.')
  if (isRead || options.method === 'PATCH' || options.method === 'POST')
    await (await import('./private-cache')).rememberPrivate(path, value).catch(() => undefined)
  if (options.method === 'DELETE')
    await (await import('./private-cache')).forgetPrivate(path).catch(() => undefined)
  return value
}

export async function downloadAttachment(orderId: string, attachment: Attachment) {
  if (import.meta.env.DEV && localWorkspace) {
    const { localAttachment } = await import('./local-workspace')
    saveBlob(await localAttachment(orderId, attachment), attachment.filename)
    return
  }
  const token = await accessToken()
  const response = await fetch(
    `${env.apiUrl}/orders/${orderId}/attachments/${attachment.id}/download`,
    {
      headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': env.organizationId },
      cache: 'no-store',
    },
  )
  if (!response.ok) throw new Error('No se pudo descargar el archivo. Vuelve a intentar.')
  saveBlob(await response.blob(), attachment.filename)
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

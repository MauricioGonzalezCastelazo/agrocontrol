import Dexie, { type EntityTable } from 'dexie'
import type { Principal } from '../../lib/api'
import { request } from '../../lib/business-api'
import { ApiError } from '../../lib/api-error'
import type { ApplicationInput, PaymentInput, Payment } from './domain'
import { sqliteWorkspace } from '../../lib/env'
import { SQLiteCaptures } from '../../lib/sqlite-captures'

export type PaymentDraft = {
  key: string
  scope: string
  customerName: string
  createdAt: string
  attempted: boolean
  lastError?: string
  lastStatus?: number
} & (
  | { kind: 'receipt'; payload: PaymentInput; paymentId?: never }
  | { kind: 'application'; payload: ApplicationInput; paymentId: string }
)
type PaymentDatabase = Dexie & {
  drafts: EntityTable<PaymentDraft, 'key'>
}
const sqliteStore = sqliteWorkspace ? new SQLiteCaptures() : undefined
const db = (sqliteStore
  ? { drafts: sqliteStore.payments }
  : new Dexie('agrocontrol-pending-payments')) as unknown as PaymentDatabase
if (!sqliteWorkspace) db.version(1).stores({ drafts: 'key, scope' })
function captureTransaction<T>(callback: (database: PaymentDatabase) => Promise<T>): Promise<T> {
  return sqliteStore
    ? sqliteStore.transaction('rw', (transaction) =>
        callback({ drafts: transaction.payments } as unknown as PaymentDatabase),
      )
    : db.transaction('rw', db.drafts, () => callback(db))
}
const scope = (principal: Principal) => `${principal.organization_id}:${principal.user_id}`
type DraftInput =
  | { kind: 'receipt'; payload: PaymentInput }
  | { kind: 'application'; payload: ApplicationInput; paymentId: string }

export async function retainPayment(principal: Principal, input: DraftInput, customerName: string) {
  const key = `${scope(principal)}:${input.payload.id}`
  return captureTransaction(async (db) => {
    const existing = await db.drafts.get(key)
    if (existing?.attempted) return existing
    const draft: PaymentDraft = {
      ...input,
      key,
      scope: scope(principal),
      customerName,
      createdAt: existing?.createdAt || new Date().toISOString(),
      attempted: false,
    }
    await db.drafts.put(draft)
    return draft
  })
}
export const listPaymentDrafts = (principal: Principal) =>
  db.drafts.where('scope').equals(scope(principal)).toArray()
export const getPaymentDraft = (principal: Principal, id: string) =>
  db.drafts.get(`${scope(principal)}:${id}`)
export async function commitPayment(principal: Principal, draft: PaymentDraft): Promise<Payment> {
  if (draft.scope !== scope(principal)) throw new Error('La captura pertenece a otra cuenta.')
  await captureTransaction(async (db) => {
    const current = await db.drafts.get(draft.key)
    if (
      !current ||
      current.kind !== draft.kind ||
      current.paymentId !== draft.paymentId ||
      JSON.stringify(current.payload) !== JSON.stringify(draft.payload)
    )
      throw new Error('La captura cambió en otra pestaña. Vuelve a abrirla antes de enviarla.')
    await db.drafts.update(draft.key, { attempted: true })
  })
  try {
    const record = await request<Payment>(
      draft.kind === 'receipt' ? '/payments' : `/payments/${draft.paymentId}/applications`,
      {
        method: 'POST',
        body: JSON.stringify(draft.payload),
      },
      principal,
    )
    await db.drafts.delete(draft.key)
    return record
  } catch (cause) {
    await db.drafts.update(draft.key, {
      lastError: cause instanceof Error ? cause.message : 'No se pudo confirmar el cobro.',
      lastStatus: cause instanceof ApiError ? cause.status : undefined,
    })
    throw cause
  }
}
// The UUID and attempted body stay fixed until a live read establishes that no record exists.
export async function reopenPayment(principal: Principal, draft: PaymentDraft) {
  if (draft.scope !== scope(principal)) throw new Error('La captura pertenece a otra cuenta.')
  if (draft.kind === 'receipt') {
    try {
      await request<Payment>(`/payments/${draft.payload.id}`, { cache: 'reload' }, principal)
      throw new Error(
        'El cobro ya existe. Reintenta para confirmar su guardado con los datos originales.',
      )
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 404) throw cause
    }
  } else {
    const payment = await request<Payment>(
      `/payments/${draft.paymentId}`,
      { cache: 'reload' },
      principal,
    )
    if (payment.applications.some((app) => app.id === draft.payload.id))
      throw new Error('La aplicación ya existe. Reintenta para confirmar su guardado.')
  }
  await db.drafts.update(draft.key, {
    attempted: false,
    lastError: undefined,
    lastStatus: undefined,
  })
}
export async function synchronizePayments(principal: Principal) {
  let failures = 0
  for (const draft of await listPaymentDrafts(principal)) {
    try {
      await commitPayment(principal, draft)
    } catch {
      failures++
    }
  }
  return failures
}

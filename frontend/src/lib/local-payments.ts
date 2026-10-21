import { z } from 'zod'
import type { WorkspaceDatabase } from './local-workspace'
import type {
  Payment,
  PaymentApplication,
  ApplicationInput,
  CustomerAccount,
} from '../features/payments/domain'
import { Exact, paymentSchema, allocationSchema, civilDate, sum } from '../features/payments/domain'
import { localPrincipal } from './local-identity'
import { ApiError } from './api-error'

export type StoredPayment = {
  id: string
  customer_id: string
  fingerprint: string
  applicationHashes: Record<string, string>
  record: Omit<Payment, 'customer_name' | 'applied_amount' | 'available_credit'>
}
const applicationSchema = z
  .object({
    id: z.string().uuid(),
    application_date: civilDate,
    description: z.string().max(4000).nullable(),
    allocations: z.array(allocationSchema).min(1).max(100),
  })
  .strict()
const voidSchema = z
  .object({
    expected_version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
function applied(record: StoredPayment['record']) {
  return record.voided_at
    ? new Exact(0)
    : sum(
        record.applications
          .filter((app) => !app.voided_at)
          .flatMap((app) => app.allocations.map((line) => line.amount)),
      )
}
export async function localPaid(db: WorkspaceDatabase, orderId: string) {
  return sum(
    (await db.payments.toArray())
      .filter((entry) => !entry.record.voided_at)
      .flatMap(({ record }) =>
        record.applications
          .filter((app) => !app.voided_at)
          .flatMap((app) =>
            app.allocations.filter((line) => line.order_id === orderId).map((line) => line.amount),
          ),
      ),
  ).toFixed(8)
}
export async function localHasHistory(db: WorkspaceDatabase, orderId: string) {
  return (await db.payments.toArray()).some(({ record }) =>
    record.applications.some((app) => app.allocations.some((line) => line.order_id === orderId)),
  )
}
export async function localHasActivePayments(db: WorkspaceDatabase, orderId: string) {
  return (await db.payments.toArray()).some(
    ({ record }) =>
      !record.voided_at &&
      record.applications.some(
        (app) => !app.voided_at && app.allocations.some((line) => line.order_id === orderId),
      ),
  )
}
async function present(db: WorkspaceDatabase, stored: StoredPayment): Promise<Payment> {
  const paid = applied(stored.record)
  return {
    ...stored.record,
    applications: await Promise.all(
      stored.record.applications.map(async (app) => ({
        ...app,
        allocations: await Promise.all(
          app.allocations.map(async (line) => ({
            ...line,
            order_deleted: Boolean((await db.orders.get(line.order_id))?.deletedAt),
          })),
        ),
      })),
    ),
    customer_name: (await db.customers.get(stored.customer_id))?.record.name || 'Cliente histórico',
    applied_amount: paid.toFixed(8),
    available_credit: stored.record.voided_at
      ? '0.00000000'
      : new Exact(stored.record.amount).minus(paid).toFixed(8),
  }
}
function paginate<T>(items: T[], url: URL, limit = 30) {
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || limit))
  return { items: items.slice(offset, offset + size), total: items.length }
}
async function addApplication(db: WorkspaceDatabase, stored: StoredPayment, raw: ApplicationInput) {
  const payload = applicationSchema.parse(raw)
  if (new Set(payload.allocations.map((line) => line.order_id)).size !== payload.allocations.length)
    throw new ApiError(422, 'Selecciona cada pedido una sola vez.')
  const allocations = payload.allocations
    .map((line) => ({ ...line, amount: new Exact(line.amount).toFixed(8) }))
    .sort((a, b) => a.order_id.localeCompare(b.order_id))
  const fingerprint = JSON.stringify({ ...payload, allocations })
  if (stored.applicationHashes[payload.id]) {
    if (stored.applicationHashes[payload.id] !== fingerprint)
      throw new ApiError(409, 'Este identificador corresponde a otra aplicación.')
    return false
  }
  if (
    (await db.payments.toArray()).some(
      (entry) => entry.id !== stored.id && entry.applicationHashes[payload.id],
    )
  )
    throw new ApiError(409, 'Este identificador corresponde a otra aplicación.')
  if (stored.record.voided_at) throw new ApiError(409, 'El cobro está anulado.')
  if (
    sum(allocations.map((line) => line.amount)).gt(
      new Exact(stored.record.amount).minus(applied(stored.record)),
    )
  )
    throw new ApiError(409, 'La aplicación supera el saldo a favor disponible de este cobro.')
  const lines: PaymentApplication['allocations'] = []
  for (const line of allocations) {
    const order = await db.orders.get(line.order_id)
    if (!order || order.deletedAt) throw new ApiError(410, 'El pedido no está disponible.')
    if (order.record.customer_id !== stored.customer_id)
      throw new ApiError(422, 'Los pedidos deben pertenecer al cliente seleccionado.')
    if (!order.record.remission_number)
      throw new ApiError(422, 'Completa la remisión del pedido antes de aplicarle un cobro.')
    if (
      new Exact(line.amount).gt(
        new Exact(order.record.total_amount).minus(await localPaid(db, order.id)),
      )
    )
      throw new ApiError(
        409,
        'La aplicación supera el saldo actual del pedido. El excedente puede quedar a favor del cliente.',
      )
    lines.push({
      ...line,
      product_type: order.record.product_type,
      remission_number: order.record.remission_number,
    })
    order.record.version++
    order.record.updated_at = new Date().toISOString()
    order.record.updated_by = localPrincipal.user_id
    await db.orders.put(order)
  }
  stored.record.applications.push({
    ...payload,
    allocations: lines,
    voided_at: null,
    void_reason: null,
  })
  stored.applicationHashes[payload.id] = fingerprint
  return true
}

export async function dispatchLocalPayments(
  db: WorkspaceDatabase,
  path: string,
  options: RequestInit,
): Promise<unknown> {
  const url = new URL(path, 'http://local.invalid'),
    parts = url.pathname.split('/').filter(Boolean)
  const method = options.method || 'GET'
  if (parts[0] === 'customer-accounts' && method === 'GET') {
    const accounts: CustomerAccount[] = []
    const q = (url.searchParams.get('q') || '').toLocaleLowerCase('es-MX')
    const selected = url.searchParams.get('customer_id')
    const allOrders = await db.orders.toArray(),
      allPayments = await db.payments.toArray()
    for (const customer of await db.customers.toArray()) {
      if (
        (selected && selected !== customer.id) ||
        !customer.record.name.toLocaleLowerCase('es-MX').includes(q)
      )
        continue
      const orders = allOrders.filter(
        (entry) => entry.record.customer_id === customer.id && !entry.deletedAt,
      )
      const payments = allPayments.filter(
        (entry) => entry.customer_id === customer.id && !entry.record.voided_at,
      )
      if (customer.deletedAt && !orders.length && !payments.length) continue
      const total = sum(orders.map((entry) => entry.record.total_amount))
      const paid = sum(await Promise.all(orders.map((entry) => localPaid(db, entry.id))))
      accounts.push({
        customer_id: customer.id,
        customer_name: customer.record.name,
        active: customer.record.active && !customer.deletedAt,
        total_orders: orders.length,
        total_amount: total.toFixed(8),
        total_paid: paid.toFixed(8),
        remaining_amount: total.minus(paid).toFixed(8),
        total_received: sum(payments.map((entry) => entry.record.amount)).toFixed(8),
        available_credit: sum(
          payments.map((entry) =>
            new Exact(entry.record.amount).minus(applied(entry.record)).toFixed(8),
          ),
        ).toFixed(8),
      })
    }
    accounts.sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'es-MX'))
    return paginate(accounts, url, 50)
  }
  if (parts[0] !== 'payments') throw new Error('Operación no disponible.')
  if (method === 'GET') {
    if (parts.length === 2) {
      const payment = await db.payments.get(parts[1])
      if (!payment) throw new ApiError(404, 'Cobro no disponible.')
      return present(db, payment)
    }
    const records = (await db.payments.toArray())
      .filter(
        (entry) =>
          !url.searchParams.get('customer_id') ||
          entry.customer_id === url.searchParams.get('customer_id'),
      )
      .sort(
        (a, b) =>
          b.record.payment_date.localeCompare(a.record.payment_date) ||
          b.record.created_at.localeCompare(a.record.created_at) ||
          a.id.localeCompare(b.id),
      )
    return paginate(await Promise.all(records.map((entry) => present(db, entry))), url)
  }
  const raw = JSON.parse(String(options.body))
  return db.transaction('rw', db.customers, db.orders, db.payments, async () => {
    if (parts.length === 1 && method === 'POST') {
      const payload = paymentSchema.parse(raw)
      payload.amount = new Exact(payload.amount).toFixed(8)
      payload.allocations = payload.allocations
        .map((line) => ({ ...line, amount: new Exact(line.amount).toFixed(8) }))
        .sort((a, b) => a.order_id.localeCompare(b.order_id))
      const fingerprint = JSON.stringify(payload)
      const existing = await db.payments.get(payload.id)
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ApiError(409, 'Este identificador corresponde a otro cobro.')
        return present(db, existing)
      }
      if (!(await db.customers.get(payload.customer_id)))
        throw new ApiError(404, 'Cliente no disponible.')
      const stored: StoredPayment = {
        id: payload.id,
        customer_id: payload.customer_id,
        fingerprint,
        applicationHashes: {},
        record: {
          id: payload.id,
          customer_id: payload.customer_id,
          amount: payload.amount,
          payment_date: payload.payment_date,
          description: payload.description,
          created_at: new Date().toISOString(),
          created_by: localPrincipal.user_id,
          version: 1,
          voided_at: null,
          void_reason: null,
          applications: [],
        },
      }
      if (payload.allocations.length)
        await addApplication(db, stored, {
          id: stored.id,
          application_date: payload.payment_date,
          description: payload.description,
          allocations: payload.allocations,
        })
      await db.payments.add(stored)
      return present(db, stored)
    }
    const stored = await db.payments.get(parts[1])
    if (!stored) throw new ApiError(404, 'Cobro no disponible.')
    if (parts.length === 3 && parts[2] === 'applications') {
      if (await addApplication(db, stored, raw)) {
        stored.record.version++
        await db.payments.put(stored)
      }
      return present(db, stored)
    }
    if (parts.at(-1) === 'void') {
      const data = voidSchema.parse(raw)
      const application =
        parts.length === 5
          ? stored.record.applications.find((entry) => entry.id === parts[3])
          : null
      if (parts.length === 5 && !application) throw new ApiError(404, 'Aplicación no disponible.')
      const target = application || stored.record
      if (target.voided_at) return present(db, stored)
      if (stored.record.version !== data.expected_version)
        throw new ApiError(409, 'El cobro cambió. Actualiza antes de anular.')
      if (stored.record.voided_at) throw new ApiError(409, 'El cobro está anulado.')
      const ids = new Set(
        (application
          ? [application]
          : stored.record.applications.filter((entry) => !entry.voided_at)
        ).flatMap((entry) => entry.allocations.map((line) => line.order_id)),
      )
      for (const id of ids) {
        const order = await db.orders.get(id)
        if (order) {
          order.record.version++
          order.record.updated_at = new Date().toISOString()
          order.record.updated_by = localPrincipal.user_id
          await db.orders.put(order)
        }
      }
      target.voided_at = new Date().toISOString()
      target.void_reason = data.reason
      stored.record.version++
      await db.payments.put(stored)
      return present(db, stored)
    }
    throw new Error('Operación no disponible.')
  })
}

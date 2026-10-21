import Dexie, { type EntityTable } from 'dexie'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { carrotSchema, canonicalDecimal, totalFor } from '../features/orders/domain'
import type { Attachment, Customer, Order, Page } from './business-api'
import { localPrincipal } from './local-identity'
import { ApiError } from './api-error'
import { calculatePotato, potatoPayload, potatoSchema } from '../features/orders/potato-domain'
import { allowedFilename } from './attachment-policy'
import type { StoredPayment } from './local-payments'
import {
  dispatchLocalPayments,
  localPaid,
  localHasHistory,
  localHasActivePayments,
} from './local-payments'
import { Exact } from '../features/payments/domain'

type StoredCustomer = { id: string; fingerprint: string; record: Customer; deletedAt?: string }
export type StoredOrder = {
  id: string
  fingerprint: string
  record: Order
  activeRemissionKey?: string
  deletedAt?: string
  updateFingerprint?: string
  removedAttachmentIds?: string[]
}
type StoredFile = { id: string; orderId: string; blob: Blob }
export type WorkspaceDatabase = Dexie & {
  customers: EntityTable<StoredCustomer, 'id'>
  orders: EntityTable<StoredOrder, 'id'>
  files: EntityTable<StoredFile, 'id'>
  payments: EntityTable<StoredPayment, 'id'>
}
const database = new Dexie('agrocontrol-local-workspace') as WorkspaceDatabase
database.version(1).stores({ customers: 'id', orders: 'id', files: 'id, orderId' })
database.version(2).stores({
  orders: 'id, &[record.product_type+record.remission_number]',
  payments: 'id, customer_id',
})
database
  .version(3)
  .stores({ orders: 'id, &activeRemissionKey' })
  .upgrade((transaction) =>
    transaction
      .table<StoredOrder>('orders')
      .toCollection()
      .modify((stored) => {
        if (!stored.deletedAt && stored.record.remission_number != null)
          stored.activeRemissionKey = activeRemissionKey(stored.record)
        else delete stored.activeRemissionKey
      }),
  )

function activeRemissionKey(record: Order) {
  return record.remission_number == null
    ? undefined
    : `${record.product_type}:${record.remission_number}`
}

const customerFields = z.object({
  name: z.string().trim().min(1).max(200),
  active: z.boolean().default(true),
  notes: z.string().trim().max(2000).nullable().default(null),
})
const attachmentSchema = z
  .object({
    id: z.string().uuid(),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((name) => !/[\p{C}/\\]/u.test(name) && name !== '..'),
    size_bytes: z
      .number()
      .int()
      .min(1)
      .max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
const orderBase = z
  .object({
    id: z.string().uuid(),
    customer_id: z.string().uuid(),
    remission_number: z.number().int().positive().max(2147483647).nullable().optional(),
    order_date: z.string(),
    description: z.string().trim().max(4000).nullable(),
    attachments: z.array(attachmentSchema).max(20),
  })
  .strict()
const orderSchema = z
  .discriminatedUnion('product_type', [
    orderBase.extend({
      product_type: z.literal('carrot'),
      details: z.object({ hectares: z.string(), unit_price: z.string() }).strict(),
    }),
    orderBase.extend({ product_type: z.literal('potato'), details: potatoSchema }),
  ])
  .superRefine((order, context) => {
    const result = carrotSchema.safeParse({
      customer_id: order.customer_id,
      order_date: order.order_date,
      ...(order.product_type === 'carrot' ? order.details : { hectares: '1', unit_price: '0' }),
      description: order.description || '',
    })
    if (
      !result.success ||
      new Set(order.attachments.map((file) => file.id)).size !== order.attachments.length ||
      order.attachments.reduce((sum, file) => sum + file.size_bytes, 0) > 100 * 1024 * 1024
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Revisa los datos y archivos del pedido.',
      })
    }
  })

function normalizeProduct(payload: z.infer<typeof orderSchema>) {
  if (payload.product_type === 'carrot') {
    payload.details.hectares = canonicalDecimal(payload.details.hectares)
    payload.details.unit_price = canonicalDecimal(payload.details.unit_price)
  } else payload.details = potatoPayload(payload.details)
}
function signature(payload: z.infer<typeof orderSchema>, expected_version?: number) {
  // Keep the original carrot serialization stable for existing browser records.
  return JSON.stringify({
    id: payload.id,
    customer_id: payload.customer_id,
    ...(payload.remission_number != null ? { remission_number: payload.remission_number } : {}),
    product_type: payload.product_type,
    order_date: payload.order_date,
    details: payload.details,
    description: payload.description,
    attachments: payload.attachments,
    ...(expected_version === undefined ? {} : { expected_version }),
  })
}
function computedProduct(payload: z.infer<typeof orderSchema>) {
  if (payload.product_type === 'carrot')
    return {
      product_type: 'carrot' as const,
      hectares: new Decimal(payload.details.hectares).toFixed(4),
      unit_price: new Decimal(payload.details.unit_price).toFixed(4),
      total_amount: totalFor(payload.details.hectares, payload.details.unit_price)!,
      potato: null,
    }
  const potato = calculatePotato(payload.details)!
  return {
    product_type: 'potato' as const,
    hectares: null,
    unit_price: null,
    total_amount: potato.total_amount,
    potato,
  }
}

function body(options: RequestInit): unknown {
  if (typeof options.body !== 'string') throw new Error('Faltan los datos para guardar.')
  return JSON.parse(options.body)
}
function page<T>(items: T[], params: URLSearchParams, defaultLimit: number): Page<T> {
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || defaultLimit))
  return { total: items.length, items: items.slice(offset, offset + limit) }
}
async function presentOrder(stored: StoredOrder): Promise<Order> {
  const customer = await database.customers.get(stored.record.customer_id)
  const paid = await localPaid(database, stored.id)
  const remaining = new Exact(stored.record.total_amount).minus(paid)
  return {
    ...stored.record,
    customer_name: customer?.record.name || stored.record.customer_name,
    total_paid: paid,
    remaining_amount: remaining.toFixed(8),
    payment_status: remaining.isZero() ? 'paid' : new Exact(paid).gt(0) ? 'partial' : 'unpaid',
  }
}
async function findOrder(id: string) {
  const order = await database.orders.get(id)
  if (!order) throw new ApiError(404, 'No encontramos este pedido en este navegador.')
  if (order.deletedAt) throw new ApiError(410, 'Este pedido fue eliminado.')
  return order
}

async function dispatch(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'http://local.invalid')
  const parts = url.pathname.split('/').filter(Boolean)
  const method = (options.method || 'GET').toUpperCase()
  if (parts[0] === 'payments' || parts[0] === 'customer-accounts')
    return dispatchLocalPayments(database, path, options)
  if (parts[0] === 'customers') {
    if (method === 'GET' && parts.length === 1) {
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase('es-MX')
      const active = url.searchParams.get('active')
      const customers = (await database.customers.toArray())
        .filter((item) => !item.deletedAt)
        .map((item) => item.record)
        .filter(
          (item) =>
            item.name.toLocaleLowerCase('es-MX').includes(q) &&
            (active === null || item.active === (active === 'true')),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'es-MX') || a.id.localeCompare(b.id))
      return page(customers, url.searchParams, 50)
    }
    if (method === 'POST' && parts.length === 1) {
      const payload = customerFields.extend({ id: z.string().uuid() }).strict().parse(body(options))
      const fingerprint = JSON.stringify(payload)
      return database.transaction('rw', database.customers, async () => {
        const existing = await database.customers.get(payload.id)
        if (existing) {
          if (existing.deletedAt) throw new ApiError(410, 'Este cliente fue eliminado.')
          if (existing.fingerprint !== fingerprint)
            throw new Error('Este identificador ya corresponde a otro cliente.')
          return existing.record
        }
        const now = new Date().toISOString()
        const record: Customer = { ...payload, version: 1, created_at: now, updated_at: now }
        await database.customers.add({ id: record.id, fingerprint, record })
        return record
      })
    }
    if (parts.length === 2 && ['GET', 'PATCH', 'DELETE'].includes(method)) {
      return database.transaction(method === 'GET' ? 'r' : 'rw', database.customers, async () => {
        const customer = await database.customers.get(parts[1])
        if (!customer) throw new Error('No encontramos este cliente en este navegador.')
        if (method === 'DELETE' && customer.deletedAt) return { id: customer.id, deleted: true }
        if (customer.deletedAt) throw new ApiError(410, 'Este cliente fue eliminado.')
        if (method === 'GET') return customer.record
        if (method === 'DELETE') {
          if (Number(url.searchParams.get('expected_version')) !== customer.record.version)
            throw new ApiError(409, 'El cliente cambió. Recarga antes de eliminarlo.')
          customer.deletedAt = new Date().toISOString()
          customer.record.active = false
          customer.record.version++
          customer.record.updated_at = customer.deletedAt
          await database.customers.put(customer)
          return { id: customer.id, deleted: true }
        }
        const payload = customerFields
          .extend({ expected_version: z.number().int().positive() })
          .strict()
          .parse(body(options))
        if (payload.expected_version !== customer.record.version)
          throw new ApiError(409, 'El cliente cambió en otra pestaña. Recarga antes de editarlo.')
        customer.record = {
          ...customer.record,
          name: payload.name,
          notes: payload.notes,
          active: payload.active,
          version: customer.record.version + 1,
          updated_at: new Date().toISOString(),
        }
        await database.customers.put(customer)
        return customer.record
      })
    }
  }
  if (parts[0] === 'orders') {
    if (method === 'GET' && parts.length === 1) {
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase('es-MX')
      const customer = url.searchParams.get('customer_id'),
        product = url.searchParams.get('product_type')
      const orders = (
        await Promise.all(
          (await database.orders.toArray()).filter((item) => !item.deletedAt).map(presentOrder),
        )
      )
        .filter(
          (item) =>
            (item.customer_name.toLocaleLowerCase('es-MX').includes(q) ||
              String(item.remission_number || '').includes(q)) &&
            (!customer || item.customer_id === customer) &&
            (!product || item.product_type === product),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      return page(orders, url.searchParams, 30)
    }
    if (method === 'POST' && parts.length === 1) {
      const payload = orderSchema.parse(body(options))
      normalizeProduct(payload)
      const fingerprint = signature(payload)
      return database.transaction(
        'rw',
        database.customers,
        database.orders,
        database.payments,
        async () => {
          const existing = await database.orders.get(payload.id)
          if (existing) {
            if (existing.deletedAt) throw new ApiError(410, 'Este pedido fue eliminado.')
            if (existing.fingerprint !== fingerprint)
              throw new Error('Este identificador ya corresponde a otro pedido.')
            return presentOrder(existing)
          }
          if (!payload.remission_number)
            throw new ApiError(422, 'Introduce el número de remisión del pedido.')
          const customer = await database.customers.get(payload.customer_id)
          if (!customer?.record.active || customer.deletedAt)
            throw new Error('Selecciona un cliente activo del directorio.')
          if (payload.attachments.some((file) => !allowedFilename(file.filename)))
            throw new Error('Formato de archivo no permitido.')
          const record: Order = {
            id: payload.id,
            customer_id: payload.customer_id,
            remission_number: payload.remission_number,
            customer_name: customer.record.name,
            ...computedProduct(payload),
            order_date: payload.order_date,
            currency: 'MXN',
            description: payload.description,
            created_by: localPrincipal.user_id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            updated_by: localPrincipal.user_id,
            version: 1,
            attachments: payload.attachments.map((file) => ({ ...file, status: 'pending' })),
            attachment_status: payload.attachments.length ? 'pending' : 'complete',
          }
          await database.orders.add({
            id: record.id,
            fingerprint,
            record,
            activeRemissionKey: activeRemissionKey(record),
          })
          return presentOrder({ id: record.id, fingerprint, record })
        },
      )
    }
    if (method === 'GET' && parts.length === 2) return presentOrder(await findOrder(parts[1]))
    if (method === 'DELETE' && parts.length === 2) {
      return database.transaction('rw', database.orders, database.payments, async () => {
        const stored = await database.orders.get(parts[1])
        if (!stored) throw new Error('No encontramos este pedido en este navegador.')
        if (stored.deletedAt) return { id: stored.id, deleted: true }
        if (await localHasActivePayments(database, stored.id))
          throw new ApiError(
            409,
            'El pedido todavía tiene cobros vigentes. Anúlalos o quita sus abonos antes de eliminarlo.',
          )
        if (Number(url.searchParams.get('expected_version')) !== stored.record.version)
          throw new ApiError(409, 'El pedido cambió. Recarga antes de eliminarlo.')
        stored.deletedAt = new Date().toISOString()
        delete stored.activeRemissionKey
        stored.record.version++
        await database.orders.put(stored)
        return { id: stored.id, deleted: true }
      })
    }
    if (method === 'PATCH' && parts.length === 2) {
      const update = z
        .object({ expected_version: z.number().int().positive() })
        .passthrough()
        .parse(body(options))
      const { expected_version, ...fields } = update
      const payload = orderSchema.parse({ ...fields, id: parts[1] })
      normalizeProduct(payload)
      const fingerprint = signature(payload, expected_version)
      return database.transaction(
        'rw',
        database.customers,
        database.orders,
        database.files,
        database.payments,
        async () => {
          const stored = await findOrder(parts[1])
          if (stored.updateFingerprint === fingerprint) return presentOrder(stored)
          if (stored.record.version !== expected_version)
            throw new ApiError(
              409,
              'El pedido cambió. Recarga y revisa los datos antes de editarlo.',
            )
          const remission = payload.remission_number ?? stored.record.remission_number ?? null
          if (
            (await localHasHistory(database, stored.id)) &&
            (payload.customer_id !== stored.record.customer_id ||
              payload.product_type !== stored.record.product_type ||
              remission !== stored.record.remission_number)
          )
            throw new ApiError(
              409,
              'Un pedido con historial de cobros conserva cliente, producto y remisión.',
            )
          if (
            new Exact(computedProduct(payload).total_amount).lt(
              await localPaid(database, stored.id),
            )
          )
            throw new ApiError(409, 'El total no puede quedar por debajo de lo ya pagado.')
          const customer = await database.customers.get(payload.customer_id)
          if (
            stored.record.customer_id !== payload.customer_id &&
            (!customer?.record.active || customer.deletedAt)
          )
            throw new ApiError(409, 'Selecciona un cliente activo del directorio.')
          const previous = stored.record.attachments
          const attachments: Attachment[] = []
          for (const manifest of payload.attachments) {
            const old = previous.find((item) => item.id === manifest.id)
            if (!old && !allowedFilename(manifest.filename))
              throw new Error('Formato de archivo no permitido.')
            const blob = await database.files.get(manifest.id)
            if (
              stored.removedAttachmentIds?.includes(manifest.id) ||
              (blob && blob.orderId !== stored.id) ||
              (old &&
                (old.filename !== manifest.filename ||
                  old.size_bytes !== manifest.size_bytes ||
                  old.sha256 !== manifest.sha256))
            )
              throw new ApiError(409, 'Un adjunto cambió. Recarga el pedido antes de editarlo.')
            if (
              !old &&
              (await database.orders.toArray()).some(
                (item) =>
                  item.removedAttachmentIds?.includes(manifest.id) ||
                  item.record.attachments.some((file) => file.id === manifest.id),
              )
            )
              throw new ApiError(409, 'Este adjunto pertenece a otro pedido.')
            attachments.push(old || { ...manifest, status: 'pending' })
          }
          stored.removedAttachmentIds = [
            ...(stored.removedAttachmentIds || []),
            ...previous
              .filter((file) => !attachments.some((item) => item.id === file.id))
              .map((file) => file.id),
          ]
          stored.record = {
            ...stored.record,
            customer_id: payload.customer_id,
            remission_number: remission,
            customer_name: customer?.record.name || stored.record.customer_name,
            order_date: payload.order_date,
            description: payload.description,
            ...computedProduct(payload),
            updated_at: new Date().toISOString(),
            updated_by: localPrincipal.user_id,
            version: stored.record.version + 1,
            attachments,
            attachment_status: attachments.some((file) => file.status !== 'ready')
              ? 'pending'
              : 'complete',
          }
          stored.updateFingerprint = fingerprint
          stored.activeRemissionKey = activeRemissionKey(stored.record)
          await database.orders.put(stored)
          return presentOrder(stored)
        },
      )
    }
    if (method === 'PUT' && parts.length === 4 && parts[2] === 'attachments') {
      const blob = options.body
      if (!(blob instanceof Blob)) throw new Error('Selecciona el archivo original.')
      // Hash before opening the transaction: crypto must not let IndexedDB auto-commit.
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      const sha256 = Array.from(new Uint8Array(digest))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
      return database.transaction('rw', database.orders, database.files, async () => {
        const stored = await findOrder(parts[1])
        if (stored.removedAttachmentIds?.includes(parts[3]))
          throw new ApiError(410, 'Este adjunto fue retirado del pedido.')
        const attachment = stored.record.attachments.find((file) => file.id === parts[3])
        if (!attachment || attachment.size_bytes !== blob.size || attachment.sha256 !== sha256)
          throw new Error('El archivo no coincide con el adjunto del pedido.')
        const existing = await database.files.get(attachment.id)
        if (existing && existing.orderId !== stored.id)
          throw new Error('El archivo pertenece a otro pedido.')
        await database.files.put({ id: attachment.id, orderId: stored.id, blob })
        if (attachment.status !== 'ready') {
          attachment.status = 'ready'
          stored.record.version++
          stored.record.updated_at = new Date().toISOString()
          stored.record.updated_by = localPrincipal.user_id
        }
        stored.record.attachment_status = stored.record.attachments.every(
          (file) => file.status === 'ready',
        )
          ? 'complete'
          : 'pending'
        await database.orders.put(stored)
        return attachment
      })
    }
  }
  throw new Error('Esta operación no está disponible en el espacio local.')
}

export async function localRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  try {
    return (await dispatch(path, options)) as T
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'ConstraintError')
      throw new ApiError(409, 'Ya existe esa remisión en un pedido vigente de este producto.')
    if (cause instanceof z.ZodError)
      throw new Error('Revisa los campos y los límites de los archivos.')
    if (
      cause instanceof Error &&
      ['QuotaExceededError', 'OpenFailedError', 'SecurityError'].includes(cause.name)
    )
      throw new Error(
        'El navegador no permite guardar o no tiene espacio. Usa una ventana normal con almacenamiento disponible y reintenta.',
      )
    throw cause
  }
}

export async function localAttachment(orderId: string, attachment: Attachment): Promise<Blob> {
  const order = await findOrder(orderId)
  const file = await database.files.get(attachment.id)
  if (
    !order.record.attachments.some(
      (item) => item.id === attachment.id && item.status === 'ready',
    ) ||
    file?.orderId !== orderId
  )
    throw new Error('Este archivo todavía no está guardado en este navegador.')
  return file.blob
}

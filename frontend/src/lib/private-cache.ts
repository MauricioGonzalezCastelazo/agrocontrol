import Dexie, { type EntityTable } from 'dexie'
import type { Customer, Order } from './business-api'
import { scopeKey, verifiedScope } from './session-scope'
import { ApiError } from './api-error'

type CachedCustomer = { key: string; scope: string; record: Customer }
type CachedOrder = { key: string; scope: string; record: Order }
const database = new Dexie('agrocontrol-authorized-cache') as Dexie & {
  customers: EntityTable<CachedCustomer, 'key'>
  orders: EntityTable<CachedOrder, 'key'>
}
database.version(1).stores({ customers: 'key, scope', orders: 'key, scope' })

export async function rememberPrivate(path: string, value: unknown) {
  const access = verifiedScope()
  if (!access) return
  const scope = scopeKey(access.principal),
    parts = new URL(path, 'http://cache.invalid').pathname.split('/').filter(Boolean)
  const [kind] = parts
  const data = value as { id?: string; items?: (Customer | Order)[] }
  if (parts.length > 2 || (kind !== 'customers' && kind !== 'orders')) return
  const items = data.items || (data.id ? [value as Customer | Order] : [])
  if (kind === 'customers')
    await database.customers.bulkPut(
      (items as Customer[]).map((record) => ({ key: `${scope}:${record.id}`, scope, record })),
    )
  else
    await database.orders.bulkPut(
      (items as Order[]).map((record) => ({ key: `${scope}:${record.id}`, scope, record })),
    )
}
export async function cachedPrivate<T>(path: string): Promise<T> {
  const access = verifiedScope()
  if (!access)
    throw new ApiError(
      401,
      'Conecta e inicia sesión para autorizar la lectura en este dispositivo.',
    )
  const scope = scopeKey(access.principal),
    url = new URL(path, 'http://cache.invalid')
  const parts = url.pathname.split('/').filter(Boolean)
  const [kind, id] = parts
  if (parts.length > 2 || (kind !== 'customers' && kind !== 'orders'))
    throw new Error('Esta consulta necesita conexión.')
  const table = kind === 'customers' ? database.customers : database.orders
  if (id) {
    const cached = await table.get(`${scope}:${id}`)
    if (access !== verifiedScope()) throw new ApiError(401, 'La autorización local venció.')
    if (!cached)
      throw new Error(
        'Este registro no se ha consultado en este dispositivo. Conecta para abrirlo.',
      )
    return cached.record as T
  }
  const q = (url.searchParams.get('q') || '').toLocaleLowerCase('es-MX')
  const records = await table.where('scope').equals(scope).toArray()
  if (access !== verifiedScope()) throw new ApiError(401, 'La autorización local venció.')
  const items = records
    .map((item) => item.record)
    .filter((record) => {
      if ('name' in record)
        return (
          record.name.toLocaleLowerCase('es-MX').includes(q) &&
          (!url.searchParams.has('active') ||
            record.active === (url.searchParams.get('active') === 'true'))
        )
      return (
        record.customer_name.toLocaleLowerCase('es-MX').includes(q) &&
        (!url.searchParams.get('product_type') ||
          record.product_type === url.searchParams.get('product_type')) &&
        (!url.searchParams.get('customer_id') ||
          record.customer_id === url.searchParams.get('customer_id'))
      )
    })
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0),
    limit = Number(url.searchParams.get('limit')) || (kind === 'customers' ? 50 : 30)
  return { items: items.slice(offset, offset + limit), total: items.length } as T
}
export async function forgetPrivate(path: string) {
  const access = verifiedScope()
  if (!access) return
  const [kind, id] = new URL(path, 'http://cache.invalid').pathname.split('/').filter(Boolean)
  if (id && (kind === 'orders' || kind === 'customers'))
    await database[kind].delete(`${scopeKey(access.principal)}:${id}`)
}

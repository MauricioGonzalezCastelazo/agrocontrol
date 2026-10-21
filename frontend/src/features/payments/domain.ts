import Decimal from 'decimal.js'
import { z } from 'zod'
import { canonicalDecimal } from '../orders/domain'
import type { Order } from '../../lib/business-api'

export const Exact = Decimal.clone({ precision: 80 })
export const remissionSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Introduce una remisión entera positiva.')
  .refine(
    (value) => /^[1-9]\d*$/.test(value) && new Exact(value).lte(2147483647),
    'La remisión no puede superar 2,147,483,647.',
  )
export const amountSchema = z.string().refine((value) => {
  const text = value
  return (
    /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(text) &&
    new Exact(text).gt(0) &&
    new Exact(text).lte('999999999999999999999999.99999999')
  )
}, 'Introduce un importe mayor a cero, con hasta ocho decimales.')
export const civilDate = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}, 'Selecciona una fecha válida.')
export const allocationSchema = z
  .object({
    order_id: z.string().uuid('Selecciona un pedido para cada abono.'),
    amount: amountSchema,
  })
  .strict()
export const paymentSchema = z
  .object({
    id: z.string().uuid(),
    customer_id: z.string().uuid('Selecciona un cliente.'),
    amount: amountSchema,
    payment_date: civilDate,
    description: z.string().max(4000).nullable(),
    allocations: z.array(allocationSchema).max(100),
  })
  .strict()
  .superRefine((data, context) => {
    if (new Set(data.allocations.map((line) => line.order_id)).size !== data.allocations.length)
      context.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'Selecciona cada pedido una sola vez.',
      })
    if (
      amountSchema.safeParse(data.amount).success &&
      data.allocations.every((line) => amountSchema.safeParse(line.amount).success) &&
      sum(data.allocations.map((line) => canonicalDecimal(line.amount))).gt(
        canonicalDecimal(data.amount),
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'La suma aplicada supera el dinero recibido.',
      })
  })
export type PaymentInput = z.infer<typeof paymentSchema>
export type ApplicationInput = {
  id: string
  application_date: string
  description: string | null
  allocations: { order_id: string; amount: string }[]
}
export type PaymentApplication = Omit<ApplicationInput, 'allocations'> & {
  voided_at: string | null
  void_reason: string | null
  allocations: {
    order_id: string
    amount: string
    product_type: 'carrot' | 'potato'
    remission_number: number | null
    order_deleted?: boolean
  }[]
}
export type Payment = {
  id: string
  customer_id: string
  customer_name: string
  amount: string
  applied_amount: string
  available_credit: string
  payment_date: string
  description: string | null
  created_at: string
  created_by: string
  version: number
  voided_at: string | null
  void_reason: string | null
  applications: PaymentApplication[]
}
export type CustomerAccount = {
  customer_id: string
  customer_name: string
  active: boolean
  total_orders: number
  total_amount: string
  total_paid: string
  remaining_amount: string
  total_received: string
  available_credit: string
}
export function sum(values: string[]) {
  return values.reduce((total, value) => total.plus(value), new Exact(0))
}
export function orderPaid(order: Order) {
  return order.total_paid || '0.00000000'
}
export function orderRemaining(order: Order) {
  return order.remaining_amount ?? new Exact(order.total_amount).minus(orderPaid(order)).toFixed(8)
}
export function orderLabel(order: Order) {
  return `${order.product_type === 'carrot' ? 'Zanahoria' : 'Papa'} · ${order.remission_number ? `Remisión ${order.remission_number}` : 'Sin remisión'} · ${order.order_date}`
}

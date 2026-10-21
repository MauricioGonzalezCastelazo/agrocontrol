import Decimal from 'decimal.js'
import { z } from 'zod'
import { groupNumber } from '../../lib/number-format'

const ExactDecimal = Decimal.clone({ precision: 40 })
export function canonicalDecimal(value: string) {
  return value.trim().replace(',', '.')
}
function validDecimal(value: string, max: string, positive: boolean) {
  const normalized = canonicalDecimal(value)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(normalized)) return false
  const number = new ExactDecimal(normalized)
  return number.gte(0) && (!positive || number.gt(0)) && number.lte(max)
}
export const carrotSchema = z.object({
  remission_number: z.string().optional(),
  customer_id: z.string().uuid('Selecciona un cliente del directorio.'),
  order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha válida.')
    .refine((value) => {
      const date = new Date(`${value}T12:00:00Z`)
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    }, 'Selecciona una fecha válida.'),
  unit_price: z
    .string()
    .refine(
      (value) => validDecimal(value, '99999999999999.9999', false),
      'Introduce un precio válido con hasta cuatro decimales.',
    ),
  hectares: z
    .string()
    .refine(
      (value) => validDecimal(value, '9999999999.9999', true),
      'Introduce hectáreas mayores a cero, con hasta cuatro decimales.',
    ),
  description: z.string().max(4000, 'La descripción admite hasta 4,000 caracteres.'),
})
export type CarrotValues = z.infer<typeof carrotSchema>

export function totalFor(hectares: string, unitPrice: string): string | null {
  if (
    !validDecimal(hectares, '9999999999.9999', true) ||
    !validDecimal(unitPrice, '99999999999999.9999', false)
  )
    return null
  return new ExactDecimal(canonicalDecimal(hectares)).times(canonicalDecimal(unitPrice)).toFixed(8)
}

export function money(value: string) {
  const [integer, fraction = ''] = value.split('.')
  const decimals = fraction.replace(/0+$/, '').padEnd(2, '0')
  return `$${groupNumber(integer)}.${decimals} MXN`
}
export function quantity(value: string) {
  return groupNumber(new ExactDecimal(value).toFixed())
}
export function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

import { z } from 'zod'
import rules from '../../../../backend/app/domain/potato-rules.json'
import { canonicalDecimal } from './domain'

export const potatoRules = rules
export type GradeCode = '1RA' | '2DA' | '3RA' | '4TA'
export type PotatoInput = {
  gross_weight: string
  tare_weight: string
  additional_shrinkage: string
  shrinkage_override?: string | null
  lines: { grade_code: GradeCode; quantity: string; unit_price: string }[]
}
export type PotatoCalculation = Omit<PotatoInput, 'lines'> & {
  calculation_version: string
  weight: string
  total_quantity: string
  shrinkage: string
  weight_after_shrinkage: string
  net_unit_weight: string
  net_total_weight: string
  total_amount: string
  lines: (PotatoInput['lines'][number] & {
    allocated_unit_weight: string
    allocated_net_weight: string
    line_total: string
  })[]
}
export type PotatoPreview = Partial<Omit<PotatoCalculation, 'lines'>> & {
  lines: Partial<PotatoCalculation['lines'][number]>[]
}

// Rational arithmetic keeps every division exact until the output boundary.
class Rational {
  constructor(
    readonly n: bigint,
    readonly d: bigint = 1n,
  ) {
    if (d === 0n) throw new Error('División entre cero')
  }
  static from(value: string) {
    const [integer, decimals = ''] = canonicalDecimal(value).split('.')
    return new Rational(BigInt(integer + decimals), 10n ** BigInt(decimals.length))
  }
  add(other: Rational) {
    return new Rational(this.n * other.d + other.n * this.d, this.d * other.d)
  }
  sub(other: Rational) {
    return new Rational(this.n * other.d - other.n * this.d, this.d * other.d)
  }
  mul(other: Rational) {
    return new Rational(this.n * other.n, this.d * other.d)
  }
  div(other: Rational) {
    return new Rational(this.n * other.d, this.d * other.n)
  }
  compare(other: Rational) {
    const difference = this.n * other.d - other.n * this.d
    return difference < 0n ? -1 : difference > 0n ? 1 : 0
  }
  fixed(places = rules.output_decimals) {
    const scaled = this.n * 10n ** BigInt(places)
    const rounded = scaled / this.d + ((scaled % this.d) * 2n >= this.d ? 1n : 0n)
    const text = rounded.toString().padStart(places + 1, '0')
    return places ? `${text.slice(0, -places)}.${text.slice(-places)}` : text
  }
}
type Expression = string | Expression[]
function evaluate(
  expression: Expression,
  context: Record<string, Rational>,
  rows: Record<string, Rational>[],
): Rational {
  if (typeof expression === 'string') return context[expression]
  const [operation, left, right] = expression
  if (operation === 'sum')
    return rows.reduce((sum, row) => sum.add(row[left as string]), new Rational(0n))
  const a = evaluate(left, context, rows),
    b = evaluate(right, context, rows)
  if (operation === 'sub') return a.sub(b)
  if (operation === 'mul') return a.mul(b)
  if (operation === 'div') return a.div(b)
  throw new Error('Fórmula desconocida')
}
function valid(value: string, max: string) {
  const text = canonicalDecimal(value)
  return (
    /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(text) &&
    Rational.from(text).compare(Rational.from(max)) <= 0
  )
}
export const potatoSchema = z
  .object({
    gross_weight: z.string(),
    tare_weight: z.string(),
    additional_shrinkage: z.string(),
    shrinkage_override: z.string().nullable().optional(),
    lines: z
      .array(
        z
          .object({
            grade_code: z.enum(['1RA', '2DA', '3RA', '4TA']),
            quantity: z.string(),
            unit_price: z.string(),
          })
          .strict(),
      )
      .length(4),
  })
  .strict()
  .superRefine((data, context) => {
    const error = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message })
    let weightsValid = true,
      quantitiesValid = true
    if (data.shrinkage_override != null && !valid(data.shrinkage_override, rules.max_weight))
      error(
        ['shrinkage_override'],
        'Introduce MERMA no negativa, con hasta cuatro decimales, o usa la cantidad total.',
      )
    for (const key of ['gross_weight', 'tare_weight', 'additional_shrinkage'] as const) {
      const value = key === 'additional_shrinkage' ? data[key] || '0' : data[key]
      if (!valid(value, rules.max_weight)) {
        error([key], 'Introduce un valor no negativo con hasta cuatro decimales.')
        weightsValid = false
      }
    }
    if (weightsValid) {
      const gross = Rational.from(data.gross_weight),
        tare = Rational.from(data.tare_weight)
      if (gross.compare(tare) <= 0) error(['gross_weight'], 'BRUTO debe ser mayor que TARA.')
      else if (Rational.from(data.additional_shrinkage || '0').compare(gross.sub(tare)) > 0)
        error(['additional_shrinkage'], 'MERMA ADICIONAL no puede superar PESO.')
    }
    let sum = new Rational(0n)
    data.lines.forEach((line, index) => {
      if (line.grade_code !== rules.grades[index].code)
        error(['lines', index, 'quantity'], 'Revisa el orden de las clasificaciones.')
      if (!valid(line.quantity || '0', rules.max_quantity)) {
        error(
          ['lines', index, 'quantity'],
          'Cantidad debe ser cero o positiva, con hasta cuatro decimales.',
        )
        quantitiesValid = false
      } else {
        const amount = Rational.from(line.quantity || '0')
        sum = sum.add(amount)
        if (amount.n > 0n && !line.unit_price.trim())
          error(
            ['lines', index, 'unit_price'],
            'Introduce el precio unitario de esta clasificación.',
          )
      }
      if (!valid(line.unit_price || '0', rules.max_price))
        error(
          ['lines', index, 'unit_price'],
          'Introduce un precio no negativo con hasta cuatro decimales.',
        )
    })
    if (quantitiesValid && sum.n === 0n)
      error(['lines', 0, 'quantity'], 'CANTIDAD TOTAL debe ser mayor que cero.')
    if (
      quantitiesValid &&
      weightsValid &&
      sum
        .add(Rational.from(data.additional_shrinkage || '0'))
        .compare(Rational.from(data.gross_weight).sub(Rational.from(data.tare_weight))) > 0
    )
      error(['additional_shrinkage'], 'CANTIDAD TOTAL y MERMA ADICIONAL no pueden superar PESO.')
  })
export function emptyPotato(): PotatoInput {
  return {
    gross_weight: '',
    tare_weight: '',
    additional_shrinkage: '0',
    shrinkage_override: null,
    lines: rules.grades.map((grade) => ({
      grade_code: grade.code as GradeCode,
      quantity: '',
      unit_price: '',
    })),
  }
}
export function potatoPayload(data: PotatoInput): PotatoInput {
  return {
    gross_weight: canonicalDecimal(data.gross_weight),
    tare_weight: canonicalDecimal(data.tare_weight),
    additional_shrinkage: canonicalDecimal(data.additional_shrinkage || '0'),
    ...(data.shrinkage_override != null
      ? { shrinkage_override: canonicalDecimal(data.shrinkage_override) }
      : {}),
    lines: data.lines.map((line) => ({
      ...line,
      quantity: canonicalDecimal(line.quantity || '0'),
      unit_price: canonicalDecimal(line.unit_price || '0'),
    })),
  }
}
function available(
  expression: Expression,
  context: Record<string, Rational>,
  rows: Record<string, Rational>[],
): boolean {
  if (typeof expression === 'string') return context[expression] !== undefined
  if (expression[0] === 'sum')
    return rows.every((row) => row[expression[1] as string] !== undefined)
  if (!available(expression[1], context, rows) || !available(expression[2], context, rows))
    return false
  return expression[0] !== 'div' || evaluate(expression[2], context, rows).n !== 0n
}
export function previewPotato(data: PotatoInput): PotatoPreview {
  const context: Record<string, Rational> = {}
  for (const key of ['gross_weight', 'tare_weight', 'additional_shrinkage'] as const) {
    const text = data[key] || (key === 'additional_shrinkage' ? '0' : '')
    if (valid(text, rules.max_weight)) context[key] = Rational.from(text)
  }
  const rows: Record<string, Rational>[] = data.lines.map((line) => {
    const row: Record<string, Rational> = {}
    if (valid(line.quantity || '0', rules.max_quantity))
      row.quantity = Rational.from(line.quantity || '0')
    const price = line.unit_price || (row.quantity?.n === 0n ? '0' : '')
    if (valid(price, rules.max_price)) row.unit_price = Rational.from(price)
    return row
  })
  for (const [name, expression] of rules.order_formulas) {
    if (!available(expression as Expression, context, rows)) continue
    if (name === 'weight' && context.gross_weight.compare(context.tare_weight) <= 0) continue
    const value = evaluate(expression as Expression, context, rows)
    if (name === 'weight_after_shrinkage' && value.n < 0n) continue
    context[name as string] = value
  }
  const lines = data.lines.map((line, index) => {
    const values: Record<string, Rational> = { ...context, ...rows[index] }
    for (const [name, expression] of rules.line_formulas) {
      if (available(expression as Expression, values, rows))
        values[name as string] = evaluate(expression as Expression, values, rows)
    }
    if (values.quantity?.n === 0n) {
      values.allocated_net_weight = new Rational(0n)
      values.line_total = new Rational(0n)
    }
    return {
      grade_code: line.grade_code,
      quantity: rows[index].quantity?.fixed(4),
      unit_price: rows[index].unit_price?.fixed(4),
      allocated_unit_weight: values.allocated_unit_weight?.fixed(),
      allocated_net_weight: values.allocated_net_weight?.fixed(),
      line_total: values.line_total?.fixed(),
    }
  })
  const sum = (key: 'allocated_net_weight' | 'line_total') =>
    context.net_unit_weight && lines.every((line) => line[key] !== undefined)
      ? lines
          .reduce((total, line) => total.add(Rational.from(line[key]!)), new Rational(0n))
          .fixed()
      : undefined
  return {
    calculation_version: rules.version,
    gross_weight: context.gross_weight?.fixed(4),
    tare_weight: context.tare_weight?.fixed(4),
    additional_shrinkage: context.additional_shrinkage?.fixed(4),
    weight: context.weight?.fixed(),
    total_quantity: context.total_quantity?.fixed(),
    shrinkage_override:
      data.shrinkage_override == null
        ? null
        : valid(data.shrinkage_override, rules.max_weight)
          ? Rational.from(data.shrinkage_override).fixed(4)
          : data.shrinkage_override,
    shrinkage:
      data.shrinkage_override != null
        ? valid(data.shrinkage_override, rules.max_weight)
          ? Rational.from(data.shrinkage_override).fixed()
          : undefined
        : context.total_quantity?.fixed(),
    weight_after_shrinkage: context.weight_after_shrinkage?.fixed(),
    net_unit_weight: context.net_unit_weight?.fixed(),
    net_total_weight: sum('allocated_net_weight'),
    total_amount: sum('line_total'),
    lines,
  }
}
export function calculatePotato(data: PotatoInput): PotatoCalculation | null {
  return potatoSchema.safeParse(data).success ? (previewPotato(data) as PotatoCalculation) : null
}

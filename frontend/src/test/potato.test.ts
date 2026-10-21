import { describe, expect, it } from 'vitest'
import Decimal from 'decimal.js'
import fixtures from '../../../backend/app/domain/potato-fixtures.json'
import {
  calculatePotato,
  emptyPotato,
  potatoSchema,
  previewPotato,
  type GradeCode,
} from '../features/orders/potato-domain'

const Exact = Decimal.clone({ precision: 60 })

function input(fixture = fixtures[1]) {
  return {
    gross_weight: fixture.gross,
    tare_weight: fixture.tare,
    additional_shrinkage: fixture.shrinkage,
    lines: (['1RA', '2DA', '3RA', '4TA'] as GradeCode[]).map((grade_code, index) => ({
      grade_code,
      quantity: fixture.quantities[index],
      unit_price: fixture.prices[index],
    })),
  }
}
describe('Motor de papa y contrato decimal compartido con Python', () => {
  it.each(fixtures)('$name: mismos resultados de referencia, sin punto flotante', (fixture) => {
    const result = calculatePotato(input(fixture))!
    expect(result).toMatchObject(fixture.expected)
    expect(result.lines.map((line) => line.line_total)).toEqual(fixture.line_totals)
    expect(
      result.lines.reduce((sum, line) => sum.plus(line.line_total), new Exact(0)).toFixed(8),
    ).toBe(result.total_amount)
    expect(
      new Decimal(result.net_total_weight)
        .minus(result.weight_after_shrinkage)
        .abs()
        .lte('0.00000002'),
    ).toBe(true)
  })
  it('calcula los resultados disponibles mientras faltan precios y mantiene la división entre cero pendiente', () => {
    const draft = emptyPotato()
    expect(calculatePotato(draft)).toBeNull()
    expect(previewPotato(draft).net_unit_weight).toBeUndefined()
    draft.gross_weight = '1000'
    draft.tare_weight = '100'
    expect(previewPotato(draft).weight).toBe('900.00000000')
    expect(previewPotato(draft).net_unit_weight).toBeUndefined()
    draft.lines[0].quantity = '100'
    expect(previewPotato(draft).net_unit_weight).toBe('8.00000000')
    expect(previewPotato(draft).total_amount).toBeUndefined()
    expect(previewPotato(draft).lines[1].line_total).toBe('0.00000000')
    draft.lines[0].unit_price = '2'
    expect(calculatePotato(draft)?.total_amount).toBe('1600.00000000')
  })
  it.each([
    [
      'precio',
      (data: ReturnType<typeof input>) => {
        data.lines[0].unit_price = '20'
      },
      '60500.00000000',
    ],
    [
      'cantidad',
      (data: ReturnType<typeof input>) => {
        data.lines[0].quantity = '700'
      },
      '61500.00000000',
    ],
    [
      'BRUTO',
      (data: ReturnType<typeof input>) => {
        data.gross_weight = '13000'
      },
      '55125.00000000',
    ],
    [
      'TARA',
      (data: ReturnType<typeof input>) => {
        data.tare_weight = '3000'
      },
      '43875.00000000',
    ],
    [
      'merma',
      (data: ReturnType<typeof input>) => {
        data.additional_shrinkage = '0'
      },
      '51750.00000000',
    ],
  ])('recalcula al cambiar %s', (_name, change, total) => {
    const data = input()
    change(data)
    expect(calculatePotato(data)?.total_amount).toBe(total)
  })
  it.each([
    (data: ReturnType<typeof input>) => {
      data.additional_shrinkage = '9201'
    },
    (data: ReturnType<typeof input>) => {
      data.gross_weight = '1'
    },
    (data: ReturnType<typeof input>) => {
      data.additional_shrinkage = '10001'
    },
    (data: ReturnType<typeof input>) => {
      data.lines[0].quantity = '-1'
    },
    (data: ReturnType<typeof input>) => {
      data.lines[0].unit_price = '-1'
    },
    (data: ReturnType<typeof input>) => {
      data.lines[0].unit_price = ''
    },
    (data: ReturnType<typeof input>) => {
      data.lines.forEach((line) => {
        line.quantity = ''
      })
    },
    (data: ReturnType<typeof input>) => {
      data.tare_weight = 'NaN'
    },
    (data: ReturnType<typeof input>) => {
      data.lines[0].quantity = '1e4'
    },
    (data: ReturnType<typeof input>) => {
      data.gross_weight = '1.23456'
    },
  ])('rechaza pesos, cantidades o precios inválidos', (change) => {
    const data = input()
    change(data)
    expect(potatoSchema.safeParse(data).success).toBe(false)
    expect(calculatePotato(data)).toBeNull()
  })
  it('descuenta ambas mermas y mantiene pendientes los pesos negativos', () => {
    const data = input()
    data.additional_shrinkage = '9200'
    expect(calculatePotato(data)?.weight_after_shrinkage).toBe('0.00000000')
    data.additional_shrinkage = '9200.0001'
    expect(previewPotato(data).weight_after_shrinkage).toBeUndefined()
    expect(previewPotato(data).total_amount).toBeUndefined()
  })
  it('MERMA automática sigue cantidades; MERMA manual y cero no cambian pesos ni importes', () => {
    const data = input()
    const automatic = calculatePotato(data)!
    expect(automatic.shrinkage).toBe('800.00000000')
    expect(automatic.shrinkage_override).toBeNull()
    for (const value of ['0', '12.5000', '99999']) {
      const manual = calculatePotato({ ...data, shrinkage_override: value })!
      expect(manual.weight_after_shrinkage).toBe(automatic.weight_after_shrinkage)
      expect(manual.total_amount).toBe(automatic.total_amount)
      expect(new Exact(manual.shrinkage).eq(value)).toBe(true)
    }
    data.lines[0].quantity = '200'
    expect(calculatePotato(data)?.shrinkage).toBe('900.00000000')
    expect(calculatePotato({ ...data, shrinkage_override: '12.5' })?.shrinkage).toBe('12.50000000')
    expect(calculatePotato({ ...data, shrinkage_override: null })?.shrinkage).toBe('900.00000000')
  })
  it.each(['', '-1', 'NaN', '1.12345', '10000000000'])(
    'rechaza MERMA manual inválida: %s',
    (value) => {
      expect(calculatePotato({ ...input(), shrinkage_override: value })).toBeNull()
      expect(previewPotato({ ...input(), shrinkage_override: value }).weight_after_shrinkage).toBe(
        '8800.00000000',
      )
    },
  )
})

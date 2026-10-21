import { describe, it, expect } from 'vitest'
import { carrotSchema, totalFor, money } from '../features/orders/domain'

describe('Captura de zanahoria por hectárea', () => {
  it.each([
    ['0.1', '0.2', '0.02000000'],
    ['1,25', '100,50', '125.62500000'],
    ['0.0001', '0.0001', '0.00000001'],
    ['2.5', '0', '0.00000000'],
    ['9999999999.9999', '99999999999999.9999', '999999999999989999000000.00000001'],
  ])('multiplica %s por %s sin perder decimales', (hectares, price, expected) => {
    expect(totalFor(hectares, price)).toBe(expected)
  })
  it.each(['-1', '0', 'NaN', 'Infinity', '1e3', '1.12345', '1,000.5'])(
    'rechaza hectáreas inválidas: %s',
    (value) => {
      expect(totalFor(value, '100')).toBeNull()
    },
  )
  it('formatea MXN sin redondear silenciosamente ni convertir a float', () => {
    expect(money('125.62500000')).toBe('$125.625 MXN')
    expect(money('999999999999989999000000.00000001')).toBe(
      '$999,999,999,999,989,999,000,000.00000001 MXN',
    )
  })
  it('exige cliente UUID y una fecha real capturada por el usuario', () => {
    const valid = {
      customer_id: '10000000-0000-4000-8000-000000000001',
      order_date: '2026-03-12',
      hectares: '1.25',
      unit_price: '100.50',
      description: 'Nota',
    }
    expect(carrotSchema.safeParse(valid).success).toBe(true)
    expect(carrotSchema.safeParse({ ...valid, customer_id: 'Nombre del cliente' }).success).toBe(
      false,
    )
    expect(carrotSchema.safeParse({ ...valid, order_date: '2026-02-30' }).success).toBe(false)
  })
})

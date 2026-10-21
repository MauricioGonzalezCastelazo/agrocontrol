import { describe, expect, it } from 'vitest'
import {
  Exact,
  amountSchema,
  remissionSchema,
  paymentSchema,
  sum,
} from '../features/payments/domain'

const id = '10000000-0000-4000-8000-000000000001'
const payload = {
  id,
  customer_id: id,
  amount: '100',
  payment_date: '2026-10-20',
  description: null,
  allocations: [],
}
describe('cobros y remisiones', () => {
  it('conserva ocho decimales incluso con importes grandes', () => {
    expect(new Exact('999999999999999999999999.99999999').minus('0.00000001').toFixed(8)).toBe(
      '999999999999999999999999.99999998',
    )
    expect(sum(['0.1', '0.2']).toFixed(8)).toBe('0.30000000')
  })
  it.each(['0', '-1', 'abc', '1e3', '1,000', '1.000000001', 'NaN', '1000000000000000000000000'])(
    'rechaza importe %s',
    (value) => {
      expect(amountSchema.safeParse(value).success).toBe(false)
      expect(() => paymentSchema.safeParse({ ...payload, amount: value })).not.toThrow()
    },
  )
  it.each(['', '0', '-82', '82.5', '082', 'abc', '2147483648'])('rechaza remisión %s', (value) => {
    expect(remissionSchema.safeParse(value).success).toBe(false)
  })
  it('acepta anticipos y aplicaciones parciales, rechaza duplicados y exceso', () => {
    expect(paymentSchema.safeParse(payload).success).toBe(true)
    expect(
      paymentSchema.safeParse({ ...payload, allocations: [{ order_id: id, amount: '30' }] })
        .success,
    ).toBe(true)
    expect(
      paymentSchema.safeParse({ ...payload, allocations: [{ order_id: id, amount: '101' }] })
        .success,
    ).toBe(false)
    expect(
      paymentSchema.safeParse({
        ...payload,
        allocations: [
          { order_id: id, amount: '10' },
          { order_id: id, amount: '10' },
        ],
      }).success,
    ).toBe(false)
    expect(paymentSchema.safeParse({ ...payload, payment_date: '2026-02-30' }).success).toBe(false)
    expect(() =>
      paymentSchema.safeParse({ ...payload, allocations: [{ order_id: id, amount: 'abc' }] }),
    ).not.toThrow()
  })
})

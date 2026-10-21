import { describe, expect, it } from 'vitest'
import { groupNumber, numericEdit } from '../lib/number-format'
import { quantity } from '../features/orders/domain'

describe('separadores de miles sin pérdida de precisión', () => {
  it.each([
    ['', ''],
    ['123', '123'],
    ['1234', '1,234'],
    ['1234567.8900', '1,234,567.8900'],
    ['1234.', '1,234.'],
    ['0.0001', '0.0001'],
    ['-1234.50', '-1,234.50'],
    ['999999999999989999000000.00000001', '999,999,999,999,989,999,000,000.00000001'],
  ])('presenta %s como %s', (raw, expected) => expect(groupNumber(raw)).toBe(expected))

  it('conserva el número canónico y la posición del cursor al insertar y pegar', () => {
    expect(numericEdit('1234.5000', 4)).toEqual({
      value: '1234.5000',
      formatted: '1,234.5000',
      start: 5,
      end: 5,
    })
    expect(numericEdit('19,234.50', 2)).toEqual({
      value: '19234.50',
      formatted: '19,234.50',
      start: 2,
      end: 2,
    })
    expect(numericEdit('1,234,567.8900', 14).value).toBe('1234567.8900')
    expect(numericEdit('1,234.50', 2, 6)).toMatchObject({ start: 1, end: 6 })
  })

  it('agrupa resultados y no convierte letras en importes válidos', () => {
    expect(quantity('1234567.89000000')).toBe('1,234,567.89')
    expect(numericEdit('12abc', 5).value).toBe('12abc')
  })
})

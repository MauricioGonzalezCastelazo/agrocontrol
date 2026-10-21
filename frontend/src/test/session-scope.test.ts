import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearVerifiedScope, scopeKey, setVerifiedScope, verifiedScope } from '../lib/session-scope'
import type { Principal } from '../lib/api'

const principal: Principal = {
  user_id: '10000000-0000-4000-8000-000000000001',
  organization_id: '20000000-0000-4000-8000-000000000001',
  role: 'operator',
}
// Only the deadline parser is exercised here; business API authentication is tested separately.
const token = `header.${btoa(JSON.stringify({ exp: 2000 }))}.synthetic-signature`

afterEach(() => {
  clearVerifiedScope()
  vi.useRealTimers()
})

describe('autorización local ya verificada por API', () => {
  it('vence exactamente con el token y no concede tiempo adicional sin red', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_999_999)
    setVerifiedScope(principal, token)
    expect(verifiedScope()?.principal).toEqual(principal)
    vi.setSystemTime(2_000_000)
    expect(verifiedScope()).toBeNull()
  })

  it('cerrar sesión bloquea inmediatamente la lectura de caché', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    setVerifiedScope(principal, token)
    clearVerifiedScope()
    expect(verifiedScope()).toBeNull()
  })

  it('separa caché por empresa, usuario y rol', () => {
    const original = scopeKey(principal)
    expect(scopeKey({ ...principal, role: 'administrator' })).not.toBe(original)
    expect(scopeKey({ ...principal, user_id: 'other-user' })).not.toBe(original)
    expect(scopeKey({ ...principal, organization_id: 'other-company' })).not.toBe(original)
  })
})

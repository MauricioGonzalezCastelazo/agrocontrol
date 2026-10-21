import { afterEach, describe, expect, it, vi } from 'vitest'
import { accessToken } from '../features/auth/AuthProvider'
import { request } from '../lib/business-api'
import { clearVerifiedScope, setVerifiedScope } from '../lib/session-scope'
import type { Principal } from '../lib/api'

vi.mock('../features/auth/AuthProvider', () => ({ accessToken: vi.fn() }))
vi.mock('../lib/env', () => ({
  env: { apiUrl: '/api/v1', organizationId: 'organization' },
  localWorkspace: false,
}))
const original: Principal = {
  organization_id: 'organization',
  user_id: 'original-user',
  role: 'operator',
}
const other: Principal = { ...original, user_id: 'other-user' }
const token = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.synthetic`
afterEach(() => {
  clearVerifiedScope()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})
describe('autorización de capturas pendientes', () => {
  it('no envía una captura con la cuenta que inició sesión después', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    setVerifiedScope(other, token)
    vi.mocked(accessToken).mockResolvedValue(token)
    await expect(request('/payments', { method: 'POST', body: '{}' }, original)).rejects.toThrow(
      'La sesión cambió',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('detecta el cambio de cuenta durante la obtención del token', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    setVerifiedScope(original, token)
    vi.mocked(accessToken).mockImplementation(async () => {
      setVerifiedScope(other, token)
      return token
    })
    await expect(request('/payments', { method: 'POST', body: '{}' }, original)).rejects.toThrow(
      'La sesión cambió',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})

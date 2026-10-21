import type { Principal } from './api'

type VerifiedScope = { principal: Principal; expiresAt: number }
let current: VerifiedScope | null = null

export function setVerifiedScope(principal: Principal, token: string) {
  // This deadline is read only after the API has verified this token and membership.
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  if (typeof payload.exp !== 'number') throw new Error('La sesión no tiene una vigencia válida.')
  current = { principal, expiresAt: payload.exp * 1000 }
}
export function clearVerifiedScope() {
  current = null
}
export function verifiedScope() {
  return current && current.expiresAt > Date.now() ? current : null
}
export function scopeKey(principal: Principal) {
  return `${principal.organization_id}:${principal.user_id}:${principal.role}`
}

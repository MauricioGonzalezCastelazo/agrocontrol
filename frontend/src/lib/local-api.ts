import type { Principal } from './api'
import { ApiError } from './api-error'
import { env } from './env'

type LocalSession = { principal: Principal; csrf: string }
let session: Promise<LocalSession> | undefined

export function initializeLocal(): Promise<LocalSession> {
  session ??= (async () => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const token = hash.get('agrocontrol-bootstrap')
    if (token)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    const response = await fetch(`${env.localApiUrl}/local/${token ? 'bootstrap' : 'session'}`, {
      method: token ? 'POST' : 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: token ? { 'Content-Type': 'application/json' } : {},
      body: token ? JSON.stringify({ token }) : undefined,
    })
    if (!response.ok)
      throw new Error('Abre AgroControl desde python main.py para autorizar este navegador.')
    return (await response.json()) as LocalSession
  })()
  return session
}

export async function localFetch(path: string, options: RequestInit = {}) {
  const authorized = await initializeLocal()
  const headers = new Headers(options.headers)
  headers.set('X-Local-CSRF', authorized.csrf)
  headers.set('X-Organization-ID', authorized.principal.organization_id)
  if (typeof options.body === 'string') headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${env.localApiUrl}${path}`, {
      ...options,
      headers,
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(
      0,
      'La API local no está disponible. El resultado es incierto: conserva la captura abierta y reintenta con los mismos datos al iniciar AgroControl.',
    )
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      typeof payload.detail === 'string'
        ? payload.detail
        : 'No se pudo guardar. Revisa los campos y vuelve a intentar.',
      response.status >= 500 ? 'uncertain' : 'rejected',
      response.headers.get('X-Operation-ID') || undefined,
    )
  }
  return response
}

export async function localRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await localFetch(path, options)
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(
      0,
      'La respuesta quedó incompleta. El resultado es incierto; reintenta con los mismos datos.',
      'uncertain',
      response.headers.get('X-Operation-ID') || undefined,
    )
  }
}

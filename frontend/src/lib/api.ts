import { env } from './env'

export type Principal = {
  user_id: string
  organization_id: string
  role: 'administrator' | 'operator'
}

export async function getPrincipal(token: string): Promise<Principal> {
  const response = await fetch(`${env.apiUrl}/session`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': env.organizationId },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('No pudimos verificar tu acceso. Consulta al administrador.')
  return response.json() as Promise<Principal>
}

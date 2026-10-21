import type { Principal } from './api'

// Namespace for browser data, not credentials or a server identity.
export const localPrincipal: Principal = {
  user_id: 'a1000000-0000-4000-8000-000000000001',
  organization_id: 'a1000000-0000-4000-8000-000000000002',
  role: 'administrator',
}

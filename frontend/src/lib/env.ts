export const env = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  organizationId: import.meta.env.VITE_ORGANIZATION_ID || '',
  preview: import.meta.env.DEV && import.meta.env.VITE_ENABLE_PREVIEW === 'true',
}
export const authConfigured = Boolean(env.supabaseUrl && env.supabaseKey && env.organizationId)

// This workspace never authenticates against, or writes to, the private API.
// It is available only in a development server on this computer.
export const localWorkspace =
  import.meta.env.DEV &&
  import.meta.env.VITE_ENABLE_LOCAL_WORKSPACE === 'true' &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname) &&
  !authConfigured

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { authConfigured, env, localWorkspace } from '../../lib/env'
import { localPrincipal } from '../../lib/local-identity'
import { getPrincipal, type Principal } from '../../lib/api'
import { clearVerifiedScope, setVerifiedScope, verifiedScope } from '../../lib/session-scope'

// Etapa 1: session only in memory. Offline credentials arrive with the reviewed offline policy.
let clientPromise: Promise<SupabaseClient> | undefined
function getAuthClient(): Promise<SupabaseClient | null> {
  if (!authConfigured) return Promise.resolve(null)
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(env.supabaseUrl, env.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  )
  return clientPromise
}
export async function accessToken() {
  const client = await getAuthClient()
  const session = await client?.auth.getSession()
  if (!session?.data.session) throw new Error('Inicia sesión para continuar.')
  return session.data.session.access_token
}
type AuthContextValue = {
  principal: Principal | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}
const AuthContext = createContext<AuthContextValue | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(
    localWorkspace ? localPrincipal : null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = useQueryClient()
  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void getAuthClient()
      .then((client) => {
        if (disposed || !client) return
        const subscription = client.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            clearVerifiedScope()
            setPrincipal(null)
            cache.clear()
          }
          if (event === 'TOKEN_REFRESHED' && session) {
            const previous = verifiedScope()
            if (previous)
              void getPrincipal(session.access_token)
                .then((principal) => {
                  if (!disposed && verifiedScope() === previous) {
                    setVerifiedScope(principal, session.access_token)
                    setPrincipal(principal)
                  }
                })
                .catch(() => undefined)
          }
        })
        unsubscribe = () => subscription.data.subscription.unsubscribe()
      })
      .catch(() => {
        if (!disposed) setError('El acceso privado no está configurado correctamente.')
      })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [cache])
  async function signIn(email: string, password: string) {
    setLoading(true)
    setError(null)
    try {
      const supabase = await getAuthClient()
      if (!supabase) return
      const result = await supabase.auth.signInWithPassword({ email, password })
      if (result.error || !result.data.session) throw new Error('Revisa tu correo y contraseña.')
      const verified = await getPrincipal(result.data.session.access_token)
      setVerifiedScope(verified, result.data.session.access_token)
      cache.clear()
      setPrincipal(verified)
    } catch (cause) {
      clearVerifiedScope()
      await getAuthClient()
        .then((client) => client?.auth.signOut({ scope: 'local' }))
        .catch(() => undefined)
      setError(cause instanceof Error ? cause.message : 'No pudimos iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }
  async function signOut() {
    if (localWorkspace) return
    clearVerifiedScope()
    setPrincipal(null)
    cache.clear()
    await (await getAuthClient())?.auth.signOut({ scope: 'local' })
  }
  useEffect(() => {
    if (localWorkspace || !principal) return
    const timer = setInterval(() => {
      if (!verifiedScope()) {
        setPrincipal(null)
        cache.clear()
      }
    }, 15_000)
    return () => clearInterval(timer)
  }, [principal, cache])
  return (
    <AuthContext.Provider value={{ principal, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider requerido')
  return value
}

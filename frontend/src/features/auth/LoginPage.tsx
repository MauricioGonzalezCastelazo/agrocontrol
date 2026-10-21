import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, LockKeyhole, Sprout, ArrowUpRight } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { Brand } from '../../components/ui'
import { authConfigured, env } from '../../lib/env'
import { useAuth } from './AuthProvider'

const schema = z.object({
  email: z.string().email('Introduce un correo válido.'),
  password: z.string().min(1, 'Introduce tu contraseña.'),
})
type LoginValues = z.infer<typeof schema>

export function LoginPage() {
  const { principal, signIn, loading, error } = useAuth()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(schema) })
  if (principal) return <Navigate to="/" replace />
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-story-content">
          <span className="light-eyebrow">
            <span className="status-dot" /> CULTIVAMOS UNA MEJOR GESTIÓN
          </span>
          <h1>
            El campo avanza.
            <br />
            <em>Tu operación también.</em>
          </h1>
          <p>
            Un lugar para conectar a tu equipo, tus clientes y cada pedido que nace en el campo.
          </p>
          <div className="field-art" aria-hidden="true">
            <Sprout size={88} strokeWidth={0.8} />
            <div />
            <div />
            <div />
          </div>
        </div>
        <p className="login-story-footer">De la tierra a una operación más clara.</p>
      </section>
      <section className="login-form-panel">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <span className="login-lock">
            <LockKeyhole size={22} strokeWidth={1.6} />
          </span>
          <p className="eyebrow">BIENVENIDO A AGROCONTROL</p>
          <h2>Todo empieza aquí.</h2>
          <p className="muted">Ingresa a tu espacio de trabajo.</p>
          {!authConfigured && (
            <div className="notice login-notice" role="status">
              <p>
                El acceso privado está pendiente de configuración. El administrador debe conectar el
                proveedor de identidad.
              </p>
            </div>
          )}
          <form
            onSubmit={handleSubmit((values) => signIn(values.email, values.password))}
            noValidate
          >
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="tu@empresa.com"
                disabled={!authConfigured}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="email-error" className="field-error">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Tu contraseña"
                disabled={!authConfigured}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="password-error" className="field-error">
                  {errors.password.message}
                </p>
              )}
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="button button-primary login-submit"
              disabled={!authConfigured || loading}
            >
              {loading ? 'Verificando acceso…' : 'Iniciar sesión'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="login-help">¿Necesitas acceso? Contacta al administrador de tu empresa.</p>
          {env.preview && (
            <Link className="preview-link" to="/vista-previa">
              Explorar la base visual <ArrowUpRight size={16} />
            </Link>
          )}
          <div className="login-security">
            <LockKeyhole size={13} /> Acceso exclusivo para personal autorizado
          </div>
        </div>
        <p className="login-copyright">AgroControl · Gestión agrícola con claridad</p>
      </section>
    </div>
  )
}

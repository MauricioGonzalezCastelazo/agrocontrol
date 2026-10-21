import { ShieldCheck, MonitorSmartphone, LogOut } from 'lucide-react'
import { PageHeader, Badge } from '../../components/ui'
import { useAuth } from '../auth/AuthProvider'
import { useBase } from '../../app/useBase'
import { localWorkspace } from '../../lib/env'

export function SettingsPage() {
  const { principal, signOut } = useAuth()
  const preview = Boolean(useBase())
  return (
    <>
      <PageHeader
        eyebrow="TU ESPACIO"
        title="Configuración"
        description="La información esencial de tu cuenta y la aplicación."
      />
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>
            <ShieldCheck size={20} />
            Mi acceso
          </h2>
          <Badge tone={preview ? 'neutral' : 'green'}>
            {localWorkspace ? 'Modo local' : preview ? 'Vista previa' : 'Sesión verificada'}
          </Badge>
        </div>
        <dl className="settings-list">
          <div>
            <dt>Perfil</dt>
            <dd>
              {localWorkspace
                ? 'Administrador local'
                : preview
                  ? 'Vista de desarrollo'
                  : principal?.role === 'administrator'
                    ? 'Administrador'
                    : 'Operador'}
            </dd>
          </div>
          <div>
            <dt>Organización</dt>
            <dd className="identifier">
              {localWorkspace
                ? 'Espacio de este navegador'
                : principal?.organization_id || 'Sin organización conectada'}
            </dd>
          </div>
          <div>
            <dt>{localWorkspace ? 'Almacenamiento' : 'Acceso privado'}</dt>
            <dd>
              {localWorkspace
                ? 'Clientes, pedidos y archivos en este navegador'
                : 'Administrado por tu empresa'}
            </dd>
          </div>
        </dl>
        {!preview && !localWorkspace && (
          <button className="button button-secondary" onClick={() => void signOut()}>
            <LogOut size={16} />
            Cerrar sesión
          </button>
        )}
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>
            <MonitorSmartphone size={20} />
            Acerca de AgroControl
          </h2>
          <Badge>v0.3</Badge>
        </div>
        <p className="muted">
          Clientes, zanahoria por hectárea y papa por clasificación, importes en MXN y adjuntos
          privados.
        </p>
        <p className="field-hint">
          {localWorkspace ? (
            'El guardado local funciona sin Supabase. Abre siempre la misma dirección y el mismo perfil del navegador. Borrar sus datos elimina los registros y archivos locales. La conexión con la nube y su migración quedan pendientes.'
          ) : (
            <>
              Los envíos pendientes se conservan en este navegador para la misma cuenta, incluso al
              cerrar sesión. La captura sin conexión requiere una sesión verificada vigente y
              clientes consultados previamente. Para volver a iniciar sesión necesitas conexión.
            </>
          )}
        </p>
      </section>
    </>
  )
}

import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Home,
  UsersRound,
  ClipboardList,
  RefreshCw,
  Settings2,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Wifi,
  WifiOff,
  Wallet,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Brand } from '../components/ui'
import { useAuth } from '../features/auth/AuthProvider'
import { localWorkspace } from '../lib/env'
import { synchronizePending } from '../features/orders/pending-files'
import { useQueryClient } from '@tanstack/react-query'
import { verifiedScope } from '../lib/session-scope'

const navigation = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/clientes', label: 'Clientes', icon: UsersRound },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { to: '/cobros', label: 'Cobros', icon: Wallet },
  { to: '/sincronizacion', label: 'Sincronización', icon: RefreshCw },
]

export function Layout({ preview = false }: { preview?: boolean }) {
  const { signOut, principal } = useAuth()
  const [online, setOnline] = useState(navigator.onLine)
  const reconnectPending = useRef(!navigator.onLine)
  const location = useLocation()
  const cache = useQueryClient()
  const prefix = preview ? '/vista-previa' : ''
  const workspacePath = location.pathname.replace(/^\/vista-previa(?=\/|$)/, '') || '/'
  const current =
    navigation.find(
      (item) =>
        item.to !== '/' && (workspacePath === item.to || workspacePath.startsWith(`${item.to}/`)),
    )?.label || 'Inicio'
  useEffect(() => {
    if (
      !online ||
      !reconnectPending.current ||
      preview ||
      localWorkspace ||
      !principal ||
      !verifiedScope() ||
      /\/(nuevo|editar|aplicar)$|^\/borradores\/|^\/cobros\/pendientes\//.test(location.pathname)
    )
      return
    reconnectPending.current = false
    void synchronizePending(principal)
      .then(() =>
        Promise.all([
          cache.invalidateQueries({ queryKey: ['pending'] }),
          cache.invalidateQueries({ queryKey: ['orders'] }),
          cache.invalidateQueries({ queryKey: ['order'] }),
          cache.invalidateQueries({ queryKey: ['accounts'] }),
          cache.invalidateQueries({ queryKey: ['payments'] }),
          cache.invalidateQueries({ queryKey: ['payment'] }),
          cache.invalidateQueries({ queryKey: ['pending-payments'] }),
        ]),
      )
      .catch(() => undefined)
  }, [online, principal, preview, location.pathname, cache])
  useEffect(() => {
    const update = () => {
      if (!navigator.onLine) reconnectPending.current = true
      setOnline(navigator.onLine)
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  useEffect(() => {
    document.title = `${current} · AgroControl`
    document.getElementById('main-content')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [location.pathname, current])

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Ir al contenido
      </a>
      <aside className="sidebar">
        <NavLink to={prefix || '/'} className="brand-link" aria-label="AgroControl, inicio">
          <Brand />
        </NavLink>
        <div className="workspace">
          <span className="workspace-symbol">AC</span>
          <div>
            <strong>Espacio de trabajo</strong>
            <small>
              {localWorkspace
                ? 'Guardado en este navegador'
                : preview
                  ? 'Vista previa del diseño'
                  : 'Operación agrícola'}
            </small>
          </div>
        </div>
        <p className="nav-caption">PRINCIPAL</p>
        <nav aria-label="Navegación principal">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={`${prefix}${to === '/' ? '' : to}` || '/'}
              end={end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{label}</span>
              <ChevronRight size={15} className="nav-chevron" />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={19} />
            <div>
              <strong>{localWorkspace ? 'Tu espacio local' : 'Un espacio privado'}</strong>
              <p>
                {localWorkspace ? (
                  'Clientes, pedidos y archivos guardados en este navegador.'
                ) : (
                  <>
                    Información de tu operación,
                    <br />
                    solo para tu equipo.
                  </>
                )}
              </p>
            </div>
          </div>
          <NavLink to={`${prefix}/configuracion`} className="nav-item">
            <Settings2 size={20} />
            <span>Configuración</span>
          </NavLink>
          {localWorkspace ? (
            <div className="profile">
              <span className="avatar">AC</span>
              <span>
                <strong>Modo local</strong>
                <small>Este equipo · sin cuenta</small>
              </span>
            </div>
          ) : (
            <button className="profile" onClick={() => void signOut()} disabled={preview}>
              <span className="avatar">{preview ? 'AC' : 'US'}</span>
              <span>
                <strong>{preview ? 'Vista de desarrollo' : 'Mi cuenta'}</strong>
                <small>
                  {preview
                    ? 'Sin datos operativos'
                    : principal?.role === 'administrator'
                      ? 'Administrador'
                      : 'Operador'}
                </small>
              </span>
              {!preview && <LogOut size={17} />}
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <SproutMark />
            <span>Mi operación</span>
            <ChevronRight size={14} />
            <strong>{current}</strong>
          </div>
          <span className={`connection ${online ? '' : 'offline'}`}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>{online ? 'Red disponible' : 'Sin conexión'}</span>
          </span>
        </header>
        {localWorkspace && (
          <div className="preview-strip">
            Modo local · Guardado habilitado
            <span>Los datos se conservan en este navegador. Aún no se envían a la nube.</span>
          </div>
        )}
        {preview && (
          <div className="preview-strip">
            Vista previa · Clientes y zanahoria{' '}
            <span>Explora los campos. El guardado requiere iniciar sesión.</span>
          </div>
        )}
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>AgroControl</span>
          <span>Hecho para el ritmo del campo.</span>
          <span>v0.2</span>
        </footer>
      </div>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={`${prefix}${to === '/' ? '' : to}` || '/'} end={end}>
            <Icon size={21} />
            <span>{label === 'Sincronización' ? 'Sincronizar' : label}</span>
          </NavLink>
        ))}
        <NavLink to={`${prefix}/configuracion`}>
          <Settings2 size={21} />
          <span>Ajustes</span>
        </NavLink>
      </nav>
    </div>
  )
}
function SproutMark() {
  return (
    <span className="breadcrumb-mark" aria-hidden="true">
      AC
    </span>
  )
}

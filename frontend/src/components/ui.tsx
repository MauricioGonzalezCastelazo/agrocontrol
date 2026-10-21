import { Sprout, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <Sprout size={25} strokeWidth={1.7} />
      </span>
      <span>
        Agro<span className="brand-light">Control</span>
        <small>GESTIÓN AGRÍCOLA</small>
      </span>
    </span>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber'
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={30} strokeWidth={1.4} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function ActionLink({
  to,
  children,
  secondary = false,
}: {
  to: string
  children: ReactNode
  secondary?: boolean
}) {
  return (
    <Link to={to} className={`button ${secondary ? 'button-secondary' : 'button-primary'}`}>
      {children}
      <ArrowUpRight size={17} aria-hidden="true" />
    </Link>
  )
}

export function PhaseNotice({
  children = 'Esta es la base de la aplicación. El registro de operaciones estará disponible en el siguiente incremento.',
}: {
  children?: ReactNode
}) {
  return (
    <div className="notice">
      <span className="status-dot" />
      <p>{children}</p>
      <Badge>Etapa 1</Badge>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="route-loading" role="status">
      <Sprout size={30} strokeWidth={1.4} />
      <p>Preparando tu espacio…</p>
    </div>
  )
}

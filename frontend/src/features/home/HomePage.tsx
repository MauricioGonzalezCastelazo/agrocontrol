import {
  ArrowRight,
  ClipboardList,
  UsersRound,
  Sprout,
  Carrot,
  Leaf,
  CircleHelp,
  Check,
  RefreshCw,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, PageHeader } from '../../components/ui'
import { useBase } from '../../app/useBase'

export function HomePage() {
  const base = useBase()
  return (
    <>
      <PageHeader
        eyebrow="TU ESPACIO DE TRABAJO"
        title="Todo listo para crecer."
        description="Tu operación agrícola, en un mismo lugar."
      />
      <section className="welcome-card">
        <div className="welcome-copy">
          <Badge tone="green">
            <span className="status-dot" /> UNA OPERACIÓN MÁS CLARA
          </Badge>
          <h2>
            Menos pendientes.
            <br />
            <em>Más campo.</em>
          </h2>
          <p>
            Conecta a tus clientes con cada pedido.
            <br />
            Construimos las bases para acompañar tu día a día.
          </p>
          <Link to={`${base}/pedidos/nuevo`} className="button button-cream">
            {base ? 'Explorar un pedido' : 'Nuevo pedido'} <ArrowRight size={17} />
          </Link>
        </div>
        <div className="landscape" aria-hidden="true">
          <div className="landscape-sun" />
          <div className="landscape-hill hill-back" />
          <div className="landscape-hill hill-middle" />
          <div className="landscape-hill hill-front" />
          <div className="landscape-lines" />
          <span className="landscape-caption">
            <Sprout size={18} /> DESDE LA RAÍZ
          </span>
        </div>
      </section>
      <div className="section-title">
        <h2>Tu día a día</h2>
        <span>Lo esencial, siempre a mano</span>
      </div>
      <div className="quick-grid">
        <Link to={`${base}/clientes`} className="quick-card">
          <span className="card-icon">
            <UsersRound size={24} strokeWidth={1.5} />
          </span>
          <ArrowRight className="card-arrow" size={20} />
          <h3>Clientes</h3>
          <p>Las personas detrás de cada operación.</p>
          <span className="text-link">
            Organizar clientes <ArrowRight size={15} />
          </span>
        </Link>
        <Link to={`${base}/pedidos`} className="quick-card">
          <span className="card-icon peach">
            <ClipboardList size={24} strokeWidth={1.5} />
          </span>
          <ArrowRight className="card-arrow" size={20} />
          <h3>Pedidos</h3>
          <p>Cada carga, con la información en su lugar.</p>
          <span className="text-link">
            Consultar pedidos <ArrowRight size={15} />
          </span>
        </Link>
      </div>
      <div className="home-bottom">
        <section className="panel products-panel">
          <div className="panel-heading">
            <h2>Lo que cultivamos</h2>
            <Leaf size={18} />
          </div>
          <p className="muted">Formularios que se adaptan a cada producto.</p>
          <div className="product-row">
            <span className="product-icon carrot">
              <Carrot size={26} strokeWidth={1.6} />
            </span>
            <div>
              <h3>Zanahoria</h3>
              <p>Hectáreas · Precio unitario</p>
            </div>
            <Badge tone="green">Por hectárea · MXN</Badge>
          </div>
          <div className="product-row">
            <span className="product-icon">
              <Sprout size={26} strokeWidth={1.6} />
            </span>
            <div>
              <h3>Papa</h3>
              <p>1RA · 2DA · 3RA · 4TA · Pesaje</p>
            </div>
            <Badge tone="green">Clasificaciones · MXN</Badge>
          </div>
        </section>
        <section className="panel progress-panel">
          <span className="eyebrow">PASO A PASO</span>
          <h2>Una base bien sembrada.</h2>
          <p className="muted">Estamos preparando tu espacio de trabajo.</p>
          <ol className="step-list">
            <li className="step-current">
              <span>
                <Check size={13} />
              </span>
              <div>
                <strong>Estructura y diseño</strong>
                <small>Base de la aplicación completada</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Clientes y pedidos</strong>
                <small>Clientes, zanahoria y papa</small>
              </div>
            </li>
            <li>
              <span>
                <RefreshCw size={12} />
              </span>
              <div>
                <strong>Trabajo sin conexión</strong>
                <small>Cálculos locales y capturas pendientes</small>
              </div>
            </li>
          </ol>
          <Link to={`${base}/configuracion`} className="subtle-link">
            <CircleHelp size={15} /> Conocer este espacio <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </>
  )
}

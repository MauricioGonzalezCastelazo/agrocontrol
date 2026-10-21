import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { PageHeader, ActionLink, EmptyState, Badge } from '../../components/ui'
import { QueryState } from '../../components/QueryState'
import { useAuth } from '../auth/AuthProvider'
import { useBase } from '../../app/useBase'
import { request, type Page } from '../../lib/business-api'
import { localWorkspace } from '../../lib/env'
import { money, dateLabel } from '../orders/domain'
import { groupNumber } from '../../lib/number-format'
import {
  Exact,
  sum,
  orderLabel,
  orderPaid,
  orderRemaining,
  type CustomerAccount,
  type Payment,
} from './domain'
import { useCustomerOrders, useAccount, allPages } from './queries'

export function ScopeNote() {
  const { principal } = useAuth()
  return !localWorkspace && principal?.role === 'operator' ? (
    <p className="field-hint">
      Ves tus pedidos y tus cobros. El pagado de cada pedido incluye los abonos del equipo. Un
      administrador puede consultar la cuenta completa del cliente.
    </p>
  ) : null
}
export function AccountBalances({
  account,
  compact = false,
}: {
  account: CustomerAccount
  compact?: boolean
}) {
  return (
    <dl className="finance-totals">
      {!compact && (
        <div>
          <dt>Total de pedidos</dt>
          <dd>{money(account.total_amount)}</dd>
        </div>
      )}
      {!compact && (
        <div>
          <dt>Abonado a pedidos</dt>
          <dd>{money(account.total_paid)}</dd>
        </div>
      )}
      <div>
        <dt>Pendiente de pedidos</dt>
        <dd>{money(account.remaining_amount)}</dd>
      </div>
      {!compact && (
        <div>
          <dt>Dinero recibido</dt>
          <dd>{money(account.total_received)}</dd>
        </div>
      )}
      <div>
        <dt>Saldo a favor disponible</dt>
        <dd>{money(account.available_credit)}</dd>
      </div>
    </dl>
  )
}
export function AccountsPage() {
  const base = useBase(),
    preview = Boolean(base),
    { principal } = useAuth()
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: ['accounts', principal?.organization_id, principal?.user_id, search, offset],
    queryFn: () =>
      request<Page<CustomerAccount>>(
        `/customer-accounts?q=${encodeURIComponent(search)}&offset=${offset}&limit=30`,
      ),
    enabled: !preview,
  })
  return (
    <>
      <PageHeader
        eyebrow="CUENTAS POR CLIENTE"
        title="Cobros y saldos"
        description="Consulta cuánto debe cada cliente y registra sus cobros."
        action={<ActionLink to={`${base}/cobros/nuevo`}>Registrar cobro</ActionLink>}
      />
      <ScopeNote />
      <section className="panel list-panel">
        <div className="list-toolbar">
          <h2>Cuentas de clientes</h2>
          <input
            className="account-search"
            type="search"
            aria-label="Buscar cuenta por cliente"
            placeholder="Buscar cliente"
            value={search}
            disabled={preview}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
          />
        </div>
        <QueryState
          loading={!preview && query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        />
        {(preview || query.data?.total === 0) && (
          <EmptyState
            icon={Wallet}
            title="Las cuentas empiezan con tus clientes"
            description="Da de alta un cliente y registra sus pedidos o un anticipo."
          />
        )}
        <div className="account-list">
          {query.data?.items.map((account) => (
            <article className="account-card" key={account.customer_id}>
              <h3>
                <Link to={`/cobros/clientes/${account.customer_id}`}>{account.customer_name}</Link>
              </h3>
              <p className="field-hint">
                {groupNumber(String(account.total_orders))} pedidos
                {!account.active ? ' · Cliente inactivo' : ''}
              </p>
              <AccountBalances account={account} compact />
              <div className="record-actions">
                <ActionLink secondary to={`/cobros/clientes/${account.customer_id}`}>
                  Ver cuenta
                </ActionLink>
                <ActionLink to={`/cobros/nuevo?customer_id=${account.customer_id}`}>
                  Registrar cobro
                </ActionLink>
              </div>
            </article>
          ))}
        </div>
        {query.data && (
          <div className="pagination">
            <span>{groupNumber(String(query.data.total))} clientes</span>
            <button
              className="button button-secondary"
              disabled={!offset}
              onClick={() => setOffset(offset - 30)}
            >
              Anterior
            </button>
            <button
              className="button button-secondary"
              disabled={offset + 30 >= query.data.total}
              onClick={() => setOffset(offset + 30)}
            >
              Siguiente
            </button>
          </div>
        )}
      </section>
    </>
  )
}
export function CustomerAccountPage() {
  const { id } = useParams(),
    { principal } = useAuth()
  const [params, setParams] = useSearchParams(),
    orderId = params.get('order_id') || ''
  const [status, setStatus] = useState<'active' | 'voided'>('active')
  const preview = Boolean(useBase())
  const account = useAccount(id),
    orders = useCustomerOrders(id)
  const payments = useQuery({
    queryKey: ['payments', principal?.organization_id, principal?.user_id, id],
    queryFn: ({ signal }) => allPages<Payment>(`/payments?customer_id=${id}`, signal),
    enabled: Boolean(id) && !preview,
  })
  const related = (payments.data || []).filter(
    (payment) =>
      !orderId ||
      payment.applications.some((app) => app.allocations.some((line) => line.order_id === orderId)),
  )
  const visible = related.filter((payment) => Boolean(payment.voided_at) === (status === 'voided'))
  return (
    <>
      <Link className="back-link" to="/cobros">
        Volver a cobros
      </Link>
      <PageHeader
        eyebrow="CUENTA DEL CLIENTE"
        title={account.data?.customer_name || 'Cuenta del cliente'}
        description="Revisa sus pedidos, registra abonos o guarda dinero como anticipo."
        action={
          <div className="record-actions">
            <ActionLink secondary to={`/cobros/nuevo?customer_id=${id}&mode=advance`}>
              Registrar anticipo
            </ActionLink>
            <ActionLink to={`/cobros/nuevo?customer_id=${id}`}>Registrar cobro</ActionLink>
          </div>
        }
      />
      <ScopeNote />
      <QueryState
        loading={account.isLoading}
        error={account.error}
        retry={() => void account.refetch()}
      />
      {account.data && (
        <section className="panel form-panel">
          <AccountBalances account={account.data} />
        </section>
      )}
      <section className="panel list-panel finance-section">
        <div className="list-toolbar">
          <h2>Pedidos del cliente</h2>
        </div>
        <QueryState
          loading={orders.isLoading}
          error={orders.error}
          retry={() => void orders.refetch()}
        />
        {orders.data?.length === 0 && <p className="empty-copy">Todavía no tiene pedidos.</p>}
        <div className="record-list">
          {orders.data?.map((order) => (
            <article className="record-row finance-order" key={order.id}>
              <div className="record-copy">
                <h3>
                  <Link to={`/pedidos/${order.id}`}>{orderLabel(order)}</Link>
                </h3>
                <p>
                  Total: {money(order.total_amount)} · Pagado: {money(orderPaid(order))}
                </p>
              </div>
              <strong>Restante: {money(orderRemaining(order))}</strong>
              <div className="record-actions">
                <ActionLink secondary to={`/pedidos/${order.id}`}>
                  Ver pedido
                </ActionLink>
                {new Exact(orderRemaining(order)).gt(0) && (
                  <ActionLink to={`/cobros/nuevo?customer_id=${id}&order_id=${order.id}`}>
                    Registrar abono
                  </ActionLink>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel list-panel finance-section">
        <div className="list-toolbar">
          <h2>Cobros del cliente</h2>
        </div>
        <div className="payment-list-controls">
          <div className="payment-filters" role="group" aria-label="Estado de los cobros">
            <button
              className="button button-secondary"
              aria-pressed={status === 'active'}
              onClick={() => setStatus('active')}
            >
              Vigentes (
              {groupNumber(String(related.filter((payment) => !payment.voided_at).length))})
            </button>
            <button
              className="button button-secondary"
              aria-pressed={status === 'voided'}
              onClick={() => setStatus('voided')}
            >
              Anulados ({groupNumber(String(related.filter((payment) => payment.voided_at).length))}
              )
            </button>
          </div>
          <label className="field" htmlFor="account-payment-order">
            Filtrar cobros por pedido
            <select
              id="account-payment-order"
              value={orderId}
              onChange={(event) =>
                setParams(event.target.value ? { order_id: event.target.value } : {})
              }
            >
              <option value="">Todos los pedidos y anticipos</option>
              {orders.data?.map((order) => (
                <option key={order.id} value={order.id}>
                  {orderLabel(order)}
                </option>
              ))}
              {orderId && !orders.data?.some((order) => order.id === orderId) && (
                <option value={orderId}>Pedido seleccionado</option>
              )}
            </select>
          </label>
          <p className="field-hint">
            Los cobros anulados no cuentan en los saldos y no impiden eliminar pedidos.
          </p>
        </div>
        <QueryState
          loading={payments.isLoading}
          error={payments.error}
          retry={() => void payments.refetch()}
        />
        {payments.data && visible.length === 0 && (
          <p className="empty-copy">
            {status === 'voided'
              ? 'No hay cobros anulados con este filtro.'
              : 'No hay cobros vigentes con este filtro.'}
          </p>
        )}
        <div className="record-list">
          {visible.map((payment) => (
            <Link
              className={`record-row finance-order ${payment.voided_at ? 'payment-inactive' : ''}`}
              to={`/cobros/${payment.id}`}
              key={payment.id}
            >
              <div className="record-copy">
                <h3>
                  {dateLabel(payment.payment_date)} · {payment.voided_at ? 'Importe anulado: ' : ''}
                  {money(payment.amount)}
                </h3>
                <p>{payment.description || 'Sin descripción'}</p>
                <Badge tone={payment.voided_at ? 'amber' : 'green'}>
                  {payment.voided_at ? 'Anulado' : 'Vigente'}
                </Badge>
                {!payment.voided_at && (
                  <p>
                    {orderId ? 'Abonado a este pedido' : 'Abonado a pedidos'}:{' '}
                    {money(
                      orderId
                        ? sum(
                            payment.applications
                              .filter((app) => !app.voided_at)
                              .flatMap((app) =>
                                app.allocations
                                  .filter((line) => line.order_id === orderId)
                                  .map((line) => line.amount),
                              ),
                          ).toFixed(8)
                        : payment.applied_amount,
                    )}{' '}
                    · Saldo a favor: {money(payment.available_credit)}
                  </p>
                )}
              </div>
              <span className="subtle-link">Ver cobro →</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}

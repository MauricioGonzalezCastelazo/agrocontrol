import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { PageHeader, ActionLink, Badge } from '../../components/ui'
import { QueryState } from '../../components/QueryState'
import { request } from '../../lib/business-api'
import { money, dateLabel } from '../orders/domain'
import { Exact, type Payment } from './domain'
import { useInvalidatePayments, usePayment } from './queries'

function VoidForm({
  payment,
  applicationId,
  onComplete,
}: {
  payment: Payment
  applicationId?: string
  onComplete: (message: string) => void
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    invalidate = useInvalidatePayments()
  const action = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error('Escribe el motivo para conservarlo en el historial.')
      return request<Payment>(
        `/payments/${payment.id}${applicationId ? `/applications/${applicationId}` : ''}/void`,
        {
          method: 'POST',
          body: JSON.stringify({ expected_version: payment.version, reason: reason.trim() }),
        },
      )
    },
    onSuccess: async () => {
      setOpen(false)
      setReason('')
      await invalidate()
      onComplete(
        applicationId
          ? 'Abono retirado. El dinero sigue registrado y queda a favor del cliente. Si no quedan otros abonos vigentes, ya puedes eliminar esos pedidos.'
          : 'Cobro anulado. Ya no cuenta en los saldos. Puedes eliminar los pedidos que hayan quedado sin otros abonos vigentes.',
      )
    },
    onError: () => {
      void invalidate()
    },
  })
  const label = applicationId ? 'Quitar abono de estos pedidos' : 'Anular cobro'
  if (!open)
    return (
      <div className="payment-correction">
        <p className="field-hint">
          {applicationId
            ? 'Quita este abono de los pedidos y conserva el dinero como saldo a favor del cliente.'
            : 'Si registraste este cobro por error, anúlalo completo. Se quitarán todos sus abonos y su saldo a favor.'}
        </p>
        <button
          className={`button ${applicationId ? 'button-secondary' : 'button-danger'}`}
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      </div>
    )
  return (
    <form
      className="void-payment"
      onSubmit={(event) => {
        event.preventDefault()
        action.mutate()
      }}
    >
      <label htmlFor={`reason-${applicationId || payment.id}`}>
        Motivo {applicationId ? 'del retiro' : 'de anulación'}
      </label>
      <textarea
        id={`reason-${applicationId || payment.id}`}
        value={reason}
        maxLength={1000}
        rows={2}
        onChange={(event) => setReason(event.target.value)}
      />
      <p className="field-hint">
        {applicationId
          ? 'El dinero seguirá registrado como recibido y quedará a favor del cliente. Estos pedidos recuperarán su saldo pendiente.'
          : 'Este cobro dejará de contar como dinero recibido. Se quitarán todos sus abonos y no quedará saldo a favor de este cobro. El registro se conservará como anulado.'}
      </p>
      {action.error && (
        <p className="field-error" role="alert">
          {action.error.message}
        </p>
      )}
      <div className="form-actions">
        <button className="button button-primary" disabled={action.isPending || !reason.trim()}>
          Confirmar {applicationId ? 'retiro del abono' : 'anulación'}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={action.isPending}
          onClick={() => setOpen(false)}
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
export function PaymentDetailPage() {
  const { id } = useParams(),
    query = usePayment(id),
    location = useLocation(),
    payment = query.data
  const [message, setMessage] = useState('')
  return (
    <>
      <Link
        className="back-link"
        to={payment ? `/cobros/clientes/${payment.customer_id}` : '/cobros'}
      >
        Volver a la cuenta del cliente
      </Link>
      <PageHeader
        eyebrow="REGISTRO DE COBRO"
        title={payment?.customer_name || 'Detalle del cobro'}
        description={
          payment
            ? `Fecha del pago: ${dateLabel(payment.payment_date)}`
            : 'Consulta del dinero recibido y los pedidos que abona.'
        }
        action={
          payment && !payment.voided_at && new Exact(payment.available_credit).gt(0) ? (
            <ActionLink to={`/cobros/${payment.id}/aplicar`}>Aplicar saldo a pedidos</ActionLink>
          ) : undefined
        }
      />
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {payment && (
        <>
          {(message || (location.state?.saved && !payment.voided_at)) && (
            <div className="notice" role="status">
              <p>
                {message || 'Movimiento guardado. Los saldos de los pedidos están actualizados.'}
              </p>
            </div>
          )}
          <section className="panel form-panel">
            <Badge tone={payment.voided_at ? 'amber' : 'green'}>
              {payment.voided_at ? 'Cobro anulado' : 'Cobro registrado'}
            </Badge>
            <dl className="finance-totals">
              <div>
                <dt>{payment.voided_at ? 'Importe anulado' : 'Dinero recibido'}</dt>
                <dd>{money(payment.amount)}</dd>
              </div>
              <div>
                <dt>Abonado a pedidos</dt>
                <dd>{money(payment.applied_amount)}</dd>
              </div>
              <div>
                <dt>Saldo a favor disponible</dt>
                <dd>{money(payment.available_credit)}</dd>
              </div>
            </dl>
            <dl className="detail-list">
              <div>
                <dt>Descripción del pago</dt>
                <dd className="description-text">{payment.description || 'Sin descripción'}</dd>
              </div>
            </dl>
            {payment.voided_at ? (
              <p className="field-hint">
                Anulado el {dateLabel(payment.voided_at.slice(0, 10))}. Motivo:{' '}
                {payment.void_reason}. Este cobro ya no afecta los saldos del cliente ni de los
                pedidos.
              </p>
            ) : (
              <VoidForm payment={payment} onComplete={setMessage} />
            )}
          </section>
          <section className="panel form-panel finance-section">
            <h2>Pedidos abonados con este cobro</h2>
            {!payment.applications.length && (
              <p>
                {payment.voided_at
                  ? 'Este anticipo fue anulado y ya no tiene saldo disponible.'
                  : 'Este cobro es un anticipo: el dinero queda a favor del cliente hasta que lo uses para abonar sus pedidos.'}
              </p>
            )}
            {payment.applications.map((application) => (
              <article
                className={`payment-application ${payment.voided_at || application.voided_at ? 'payment-inactive' : ''}`}
                key={application.id}
              >
                <h3>{dateLabel(application.application_date)}</h3>
                <Badge tone={payment.voided_at || application.voided_at ? 'amber' : 'green'}>
                  {payment.voided_at
                    ? 'Cobro anulado'
                    : application.voided_at
                      ? 'Abono retirado'
                      : 'Abono vigente'}
                </Badge>
                <p className="description-text">{application.description || 'Sin descripción'}</p>
                <ul className="allocation-history">
                  {application.allocations.map((line) => (
                    <li key={line.order_id}>
                      {line.order_deleted ? (
                        <span>
                          {line.product_type === 'carrot' ? 'Zanahoria' : 'Papa'} · Remisión{' '}
                          {line.remission_number} · Pedido eliminado
                        </span>
                      ) : (
                        <Link to={`/pedidos/${line.order_id}`}>
                          {line.product_type === 'carrot' ? 'Zanahoria' : 'Papa'} · Remisión{' '}
                          {line.remission_number}
                        </Link>
                      )}
                      <strong>{money(line.amount)}</strong>
                    </li>
                  ))}
                </ul>
                {!application.allocations.length && (
                  <p className="field-hint">
                    Este abono incluye pedidos fuera de tu acceso. Consulta a un administrador.
                  </p>
                )}
                {application.voided_at && (
                  <p className="field-hint">
                    Motivo del retiro: {application.void_reason}. Este abono ya no cuenta en los
                    pedidos.
                  </p>
                )}
                {!payment.voided_at && !application.voided_at && (
                  <VoidForm
                    payment={payment}
                    applicationId={application.id}
                    onComplete={setMessage}
                  />
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </>
  )
}

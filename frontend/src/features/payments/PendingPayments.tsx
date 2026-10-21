import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { useBase } from '../../app/useBase'
import { QueryState } from '../../components/QueryState'
import { listPaymentDrafts, synchronizePayments } from './payment-drafts'
import { useInvalidatePayments } from './queries'
import { money } from '../orders/domain'

export function PendingPayments() {
  const { principal } = useAuth(),
    preview = Boolean(useBase()),
    invalidate = useInvalidatePayments()
  const query = useQuery({
    queryKey: ['pending-payments', principal?.organization_id, principal?.user_id],
    queryFn: () => listPaymentDrafts(principal!),
    enabled: Boolean(principal) && !preview,
  })
  const retry = useMutation({
    mutationFn: () => synchronizePayments(principal!),
    onSettled: invalidate,
  })
  if (preview) return null
  return (
    <section className="panel form-panel finance-section">
      <h2>Cobros por confirmar</h2>
      <p className="field-hint">
        Una captura pendiente todavía no modifica los saldos. Reintenta para confirmar el movimiento
        sin duplicarlo.
      </p>
      <QueryState
        loading={query.isLoading}
        error={query.error || retry.error}
        retry={() => void query.refetch()}
      />
      {query.data?.length === 0 && <p>No hay cobros pendientes de confirmación.</p>}
      {query.data?.map((draft) => (
        <article className="payment-application" key={draft.key}>
          <h3>
            {draft.customerName} ·{' '}
            {draft.kind === 'receipt' ? money(draft.payload.amount) : 'Aplicación de saldo a favor'}
          </h3>
          {draft.lastError && <p className="field-error">{draft.lastError}</p>}
          <Link className="subtle-link" to={`/cobros/pendientes/${draft.payload.id}`}>
            Revisar captura y reintentar
          </Link>
        </article>
      ))}
      {Boolean(query.data?.length) && (
        <button
          className="button button-primary"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {retry.isPending ? 'Confirmando…' : 'Reintentar cobros pendientes'}
        </button>
      )}
    </section>
  )
}

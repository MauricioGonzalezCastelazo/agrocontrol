import { useState } from 'react'
import { groupNumber } from '../../lib/number-format'
import { Link, useLocation } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CloudOff, RefreshCw } from 'lucide-react'
import { PageHeader, Badge } from '../../components/ui'
import { QueryState } from '../../components/QueryState'
import { useBase } from '../../app/useBase'
import { useAuth } from '../auth/AuthProvider'
import { localWorkspace } from '../../lib/env'
import { listPending, synchronizePending } from '../orders/pending-files'
import { ConflictResolution } from '../orders/ConflictResolution'
import { PendingPayments } from '../payments/PendingPayments'

export function SyncPage() {
  const location = useLocation()
  const preview = Boolean(useBase()),
    { principal } = useAuth(),
    [message, setMessage] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['pending', principal?.organization_id, principal?.user_id],
    queryFn: () => listPending(principal!),
    enabled: !preview && Boolean(principal),
  })
  const retry = useMutation({
    mutationFn: async () => {
      if (!principal) return
      const failures = await synchronizePending(principal)
      setMessage(
        failures
          ? 'Algunos envíos siguen pendientes. Revisa su pedido o vuelve a intentar con conexión.'
          : 'Se revisaron los envíos. Consulta el pedido para confirmar el estado de todos sus archivos.',
      )
    },
    onSettled: () => void query.refetch(),
  })
  return (
    <>
      <PageHeader
        eyebrow={localWorkspace ? 'GUARDADO EN ESTE NAVEGADOR' : 'DEL DISPOSITIVO AL EQUIPO'}
        title="Siempre a la vista."
        description={
          localWorkspace
            ? 'Estado de las capturas y archivos de tu espacio local.'
            : 'Capturas y archivos pendientes de enviar desde este dispositivo.'
        }
      />
      {location.state?.queued && (
        <div className="notice" role="status">
          <p>
            Captura guardada en este dispositivo. Se enviará al recuperar conexión; sus archivos
            siguen pendientes hasta confirmarse.
          </p>
        </div>
      )}
      <div className="notice">
        <p>
          {localWorkspace ? (
            'Los clientes, pedidos y adjuntos se guardan en este navegador. No hay conexión con la nube; no se compartirán con otros dispositivos automáticamente.'
          ) : (
            <>
              Puedes capturar sin conexión con una sesión aún vigente y clientes ya consultados en
              este equipo. Los envíos se reintentan al recuperar internet mientras la aplicación
              esté abierta.
            </>
          )}
        </p>
      </div>
      <PendingPayments />
      <section className="panel sync-panel">
        <span className="empty-icon">
          <CloudOff size={32} strokeWidth={1.4} />
        </span>
        <Badge tone="amber">Envíos pendientes</Badge>
        <h2>Cada archivo, en su lugar.</h2>
        <p>
          {localWorkspace ? (
            'Si un guardado quedó incompleto, puedes reintentarlo aquí. Los registros confirmados se consultan en Clientes y Pedidos.'
          ) : (
            <>
              Las capturas pendientes y sus archivos se conservan en este navegador para reintentar
              con la misma cuenta. El navegador puede eliminar su almacenamiento: confirma el
              guardado en el servidor antes de borrar datos o cambiar de dispositivo.
            </>
          )}
        </p>
        {preview ? (
          <button className="button button-primary" disabled>
            <RefreshCw size={17} />
            Sincronizar · Próximamente
          </button>
        ) : (
          <>
            <QueryState loading={query.isLoading} error={query.error} />
            <p>
              {groupNumber(String(query.data?.drafts.length || 0))} capturas por confirmar ·{' '}
              {groupNumber(String(query.data?.orderIds.length || 0))} pedidos con archivos locales
            </p>
            <button
              className="button button-primary"
              disabled={retry.isPending || !query.data}
              onClick={() => retry.mutate()}
            >
              <RefreshCw size={17} />
              {retry.isPending ? 'Reintentando…' : 'Reintentar envíos'}
            </button>
            {query.data?.orderIds.map((id) => (
              <Link className="subtle-link" key={id} to={`/pedidos/${id}`}>
                Revisar pedido {id.slice(0, 8)}
              </Link>
            ))}
            {query.data?.drafts.map((draft) => (
              <article className="pending-draft" key={draft.key}>
                <strong>
                  {draft.payload.product_type === 'potato' ? 'Papa' : 'Zanahoria'} ·{' '}
                  {draft.customerName || draft.orderId.slice(0, 8)}
                </strong>
                <p className="field-hint">
                  {draft.attempted === false
                    ? 'Borrador pendiente de enviar'
                    : 'Confirmación pendiente · Reintenta antes de cambiar sus datos'}
                </p>
                {draft.lastError && <p className="field-error">{draft.lastError}</p>}
                {draft.lastStatus === 409 && draft.operation === 'update' && (
                  <ConflictResolution draft={draft} />
                )}
                <Link className="button button-secondary" to={`/borradores/${draft.orderId}`}>
                  {draft.attempted === false ? 'Editar borrador' : 'Revisar captura'}
                </Link>
              </article>
            ))}
          </>
        )}
        {message && <p role="status">{message}</p>}
        {retry.error && (
          <p role="alert" className="field-error">
            {retry.error.message}
          </p>
        )}
      </section>
    </>
  )
}

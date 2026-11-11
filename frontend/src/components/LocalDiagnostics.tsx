import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { localRequest } from '../lib/local-api'
import { ApiError } from '../lib/api-error'

type Report = {
  ok: boolean
  checked_at_utc: string
  findings: { category: string; code: string; id?: string; path?: string }[]
  preservation: { installation_id: string; schema_revision: string; external_backup: string }
}

export function LocalDiagnostics() {
  const [report, setReport] = useState<Report | null>(null)
  const [reason, setReason] = useState('')
  const [preserve, setPreserve] = useState(true)
  const [attempt, setAttempt] = useState<{
    id: string
    reason: string
    preserve_temporaries: boolean
  } | null>(null)
  const check = useMutation({
    mutationFn: () => localRequest<Report>('/local/diagnostics'),
    onSuccess: setReport,
  })
  const reconcile = useMutation({
    mutationFn: async () => {
      const original = attempt || {
        id: crypto.randomUUID(),
        reason: reason.trim(),
        preserve_temporaries: preserve,
      }
      setAttempt(original)
      return localRequest<{
        diagnostics: Report
        confirmed_documents: number
        preserved_temporaries: number
      }>('/local/documents/reconcile', {
        method: 'POST',
        headers: { 'Idempotency-Key': original.id },
        body: JSON.stringify({
          reason: original.reason,
          preserve_temporaries: original.preserve_temporaries,
        }),
      })
    },
    onSuccess: (result) => {
      setReport(result.diagnostics)
      setAttempt(null)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.outcome === 'rejected') setAttempt(null)
    },
  })
  const busy = check.isPending || reconcile.isPending
  return (
    <section className="panel form-panel">
      <h2>Integridad y documentos locales</h2>
      <p>
        Revisa relaciones, cálculos, saldos, remisiones y documentos. La revisión no modifica los
        registros.
      </p>
      <button className="button button-secondary" disabled={busy} onClick={() => check.mutate()}>
        {check.isPending ? 'Revisando…' : 'Revisar integridad'}
      </button>
      {(check.error || reconcile.error) && (
        <p className="field-error" role="alert">
          {check.error?.message || reconcile.error?.message}
        </p>
      )}
      {report && (
        <div role="status">
          <p>
            {report.ok
              ? 'Revisión terminada sin hallazgos.'
              : `Revisión terminada: ${report.findings.length} hallazgos requieren atención.`}{' '}
            Fecha UTC: {report.checked_at_utc}.
          </p>
          {report.findings.length > 0 && (
            <details>
              <summary>Consultar hallazgos</summary>
              <ul>
                {report.findings.map((item, index) => (
                  <li key={index}>
                    {item.category}: {item.code} {item.id || item.path || ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <p>
        La conciliación confirma únicamente documentos cuyo tamaño, hash y formato coinciden. Los
        faltantes o dañados requieren el original. Los temporales antiguos se conservan; no se
        borran.
      </p>
      <label>
        Motivo de conciliación
        <textarea
          maxLength={1000}
          value={reason}
          disabled={busy || Boolean(attempt)}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={preserve}
          disabled={busy || Boolean(attempt)}
          onChange={(event) => setPreserve(event.target.checked)}
        />
        Conservar una copia verificada de temporales abandonados
      </label>
      <button
        className="button button-secondary"
        disabled={busy || (!attempt && !reason.trim())}
        onClick={() => reconcile.mutate()}
      >
        {reconcile.isPending
          ? 'Conciliando…'
          : attempt
            ? 'Reintentar la misma conciliación'
            : 'Conciliar documentos'}
      </button>
      {reconcile.data && (
        <p role="status">
          Operación confirmada: {reconcile.data.confirmed_documents} documentos confirmados y{' '}
          {reconcile.data.preserved_temporaries} temporales conservados.
        </p>
      )}
      <p className="field-hint">
        El respaldo externo sigue pendiente. Este diagnóstico y las copias locales no certifican
        protección fuera del equipo.
      </p>
    </section>
  )
}

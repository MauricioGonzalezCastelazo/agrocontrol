import { useId, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { request } from '../lib/business-api'
import { useAuth } from '../features/auth/AuthProvider'
import { discardPendingOrder } from '../features/orders/pending-files'
import { ApiError } from '../lib/api-error'

export function DeleteRecordButton({
  kind,
  id,
  version,
  name,
  onDeleted,
  blockReason,
  blockAction,
}: {
  kind: 'customer' | 'order'
  id: string
  version: number
  name: string
  onDeleted: () => void
  blockReason?: string
  blockAction?: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId(),
    descriptionId = useId()
  const { principal } = useAuth()
  const cache = useQueryClient()
  const noun = kind === 'customer' ? 'cliente' : 'pedido'
  const [reason, setReason] = useState('')
  const [attempt, setAttempt] = useState<{ version: number; reason: string } | null>(null)
  const remove = useMutation({
    mutationFn: () => {
      const original = attempt || { version, reason: reason.trim() }
      if (!original.reason) throw new Error('Escribe el motivo de eliminación.')
      setAttempt(original)
      return request(
        `/${kind === 'customer' ? 'customers' : 'orders'}/${id}?expected_version=${original.version}`,
        { method: 'DELETE', body: JSON.stringify({ reason: original.reason }) },
      )
    },
    onError: (error) => {
      if (error instanceof ApiError && error.outcome === 'rejected') setAttempt(null)
    },
    onSuccess: async () => {
      if (kind === 'order' && principal)
        await discardPendingOrder(principal, id).catch(() => undefined)
      dialog.current?.close()
      onDeleted()
      if (kind === 'customer')
        cache.removeQueries({ queryKey: ['customer', principal?.organization_id, id] })
      else
        cache.removeQueries({
          queryKey: ['order', principal?.organization_id, principal?.user_id, id],
        })
      await Promise.all(
        [
          'customers',
          'customer-picker',
          'orders',
          'pending',
          'accounts',
          'account-picker',
          'payments',
          'payment',
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      )
    },
  })
  return (
    <>
      <button
        type="button"
        className="button button-danger"
        onClick={() => {
          remove.reset()
          dialog.current?.showModal()
          cancel.current?.focus()
        }}
      >
        <Trash2 size={16} aria-hidden="true" /> Eliminar {noun}
      </button>
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (remove.isPending) event.preventDefault()
        }}
      >
        <h2 id={titleId}>¿Eliminar este {noun}?</h2>
        <p className="delete-record-name">{name}</p>
        <p id={descriptionId}>
          {blockReason ||
            (kind === 'customer'
              ? 'Dejará de aparecer en el directorio y en los pedidos nuevos. Sus pedidos existentes conservarán el nombre y el historial.'
              : 'Dejará de aparecer en tus pedidos y sus archivos adjuntos dejarán de estar disponibles. Los cobros anulados o abonos retirados se conservarán en el historial y no impiden eliminarlo.')}
        </p>
        {blockAction}
        {!blockReason && (
          <label>
            Motivo de eliminación
            <textarea
              value={reason}
              maxLength={1000}
              required
              disabled={remove.isPending || Boolean(attempt)}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        {remove.error && (
          <p className="field-error" role="alert">
            {remove.error.message}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button button-secondary"
            ref={cancel}
            autoFocus
            disabled={remove.isPending}
            onClick={() => dialog.current?.close()}
          >
            Cancelar
          </button>
          {!blockReason && (
            <button
              type="button"
              className="button button-danger"
              disabled={remove.isPending || (!attempt && !reason.trim())}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Eliminando…' : `Eliminar ${noun}`}
            </button>
          )}
        </div>
      </dialog>
    </>
  )
}

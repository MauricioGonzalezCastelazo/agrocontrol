import { useId, useRef, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { request } from '../lib/business-api'
import { useAuth } from '../features/auth/AuthProvider'
import { discardPendingOrder } from '../features/orders/pending-files'

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
  const titleId = useId(),
    descriptionId = useId()
  const { principal } = useAuth()
  const cache = useQueryClient()
  const noun = kind === 'customer' ? 'cliente' : 'pedido'
  const remove = useMutation({
    mutationFn: () =>
      request(
        `/${kind === 'customer' ? 'customers' : 'orders'}/${id}?expected_version=${version}`,
        { method: 'DELETE' },
      ),
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
        {remove.error && (
          <p className="field-error" role="alert">
            {remove.error.message}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button button-secondary"
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
              disabled={remove.isPending}
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

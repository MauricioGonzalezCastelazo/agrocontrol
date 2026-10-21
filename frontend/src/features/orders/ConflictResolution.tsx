import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { request, type Order, type OrderFields } from '../../lib/business-api'
import { useAuth } from '../auth/AuthProvider'
import { commitDraft, resolvePendingConflict, type PendingDraft } from './pending-files'
import { money, quantity } from './domain'
import { calculatePotato } from './potato-domain'

function fields(order: Order): OrderFields {
  const common = {
    customer_id: order.customer_id,
    remission_number: order.remission_number,
    order_date: order.order_date,
    description: order.description,
    attachments: order.attachments.map(({ id, filename, size_bytes, sha256 }) => ({
      id,
      filename,
      size_bytes,
      sha256,
    })),
  }
  return order.product_type === 'carrot'
    ? {
        ...common,
        product_type: 'carrot',
        details: { hectares: order.hectares, unit_price: order.unit_price },
      }
    : {
        ...common,
        product_type: 'potato',
        details: {
          gross_weight: order.potato.gross_weight,
          tare_weight: order.potato.tare_weight,
          additional_shrinkage: order.potato.additional_shrinkage,
          shrinkage_override: order.potato.shrinkage_override ?? null,
          lines: order.potato.lines.map(({ grade_code, quantity, unit_price }) => ({
            grade_code,
            quantity,
            unit_price,
          })),
        },
      }
}
function Facts({ data, name, total }: { data: OrderFields; name: string; total?: string }) {
  const potato = data.product_type === 'potato' ? calculatePotato(data.details) : null
  const rows: [string, string][] = [
    ['Cliente', name],
    ['Remisión', String(data.remission_number || 'Sin remisión')],
    ['Producto', data.product_type === 'carrot' ? 'Zanahoria' : 'Papa'],
    ['Fecha', data.order_date],
    ['Descripción', data.description || 'Sin descripción'],
  ]
  if (data.product_type === 'carrot')
    rows.push(
      ['Hectáreas', quantity(data.details.hectares)],
      ['Precio unitario', money(data.details.unit_price)],
    )
  else
    rows.push(
      ['BRUTO', quantity(data.details.gross_weight)],
      ['TARA', quantity(data.details.tare_weight)],
      ['MERMA ADICIONAL', quantity(data.details.additional_shrinkage)],
      [
        'MERMA',
        potato ? quantity(potato.shrinkage) : data.details.shrinkage_override || 'Automática',
      ],
      ...data.details.lines.map((line): [string, string] => [
        line.grade_code,
        `Cantidad ${quantity(line.quantity)} · Precio ${money(line.unit_price)}`,
      ]),
    )
  if (total || potato) rows.push(['Total del pedido', money(total || potato!.total_amount)])
  rows.push([
    'Archivos',
    data.attachments.map((file) => file.filename).join(', ') || 'Sin archivos',
  ])
  return (
    <dl className="detail-list">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
export function ConflictResolution({ draft }: { draft: PendingDraft }) {
  const { principal } = useAuth(),
    cache = useQueryClient()
  const [server, setServer] = useState<Order | null>(null)
  const compare = useMutation({
    mutationFn: () => request<Order>(`/orders/${draft.orderId}`, { cache: 'reload' }),
    onSuccess: setServer,
  })
  const resolve = useMutation({
    mutationFn: async (keepLocal: boolean) => {
      if (!principal || !server) return
      if (
        !window.confirm(
          keepLocal
            ? 'Se aplicarán los cambios de tu captura sobre la versión mostrada del servidor. ¿Continuar?'
            : 'Se descartarán los cambios y archivos nuevos de esta captura local. El pedido del servidor se conserva. ¿Continuar?',
        )
      )
        return
      const resolved = await resolvePendingConflict(principal, draft, server, keepLocal)
      if (resolved) await commitDraft(principal, resolved)
    },
    onSuccess: async () => {
      await Promise.all(
        ['pending', 'orders', 'order'].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      )
    },
  })
  return (
    <div className="conflict-resolution">
      <p role="alert">
        Este pedido cambió en otro dispositivo. Compara las capturas antes de decidir qué conservar.
      </p>
      <button
        type="button"
        className="button button-secondary"
        disabled={compare.isPending}
        onClick={() => compare.mutate()}
      >
        {compare.isPending ? 'Consultando…' : 'Comparar versiones'}
      </button>
      {server && (
        <>
          <div className="conflict-columns">
            <section>
              <h3>Versión del servidor</h3>
              <Facts
                data={fields(server)}
                name={server.customer_name}
                total={server.total_amount}
              />
            </section>
            <section>
              <h3>Tu captura local</h3>
              <Facts data={draft.payload} name={draft.customerName || draft.payload.customer_id} />
            </section>
          </div>
          <div className="record-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate(false)}
            >
              Conservar versión del servidor
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate(true)}
            >
              Usar mis cambios
            </button>
          </div>
        </>
      )}
      {(compare.error || resolve.error) && (
        <p className="field-error" role="alert">
          {compare.error?.message || resolve.error?.message}
        </p>
      )}
    </div>
  )
}

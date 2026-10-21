import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PageHeader, ActionLink } from '../../components/ui'
import { NumberInput } from '../../components/NumberInput'
import { QueryState } from '../../components/QueryState'
import { CustomerSelect } from '../customers/CustomerSelect'
import { request, type Page } from '../../lib/business-api'
import { useBase } from '../../app/useBase'
import { useAuth } from '../auth/AuthProvider'
import { localWorkspace } from '../../lib/env'
import { useUnsavedCapture } from '../../lib/useUnsavedCapture'
import { localToday, money, canonicalDecimal } from '../orders/domain'
import {
  Exact,
  amountSchema,
  civilDate,
  orderLabel,
  orderRemaining,
  paymentSchema,
  sum,
  type CustomerAccount,
  type Payment,
} from './domain'
import { useAccount, useCustomerOrders, useInvalidatePayments, usePayment } from './queries'
import {
  commitPayment,
  getPaymentDraft,
  reopenPayment,
  retainPayment,
  type PaymentDraft,
} from './payment-drafts'

type Line = { key: string; product: string; order_id: string; amount: string; manual?: boolean }
export function PaymentFormPage({ credit = false }: { credit?: boolean }) {
  const { id } = useParams(),
    payment = usePayment(credit ? id : undefined)
  if (credit && !payment.data)
    return (
      <QueryState
        loading={payment.isLoading}
        error={payment.error}
        retry={() => void payment.refetch()}
      />
    )
  return <PaymentForm key={credit ? id : 'new'} payment={credit ? payment.data : undefined} />
}
export function PendingPaymentPage() {
  const { id } = useParams(),
    { principal } = useAuth()
  const draft = useQuery({
    queryKey: ['pending-payments', principal?.organization_id, principal?.user_id, id],
    queryFn: async () => {
      const record = await getPaymentDraft(principal!, id!)
      if (!record)
        throw new Error('Esta captura ya se confirmó o no está disponible para tu cuenta.')
      return record
    },
    enabled: Boolean(principal),
  })
  const payment = usePayment(draft.data?.kind === 'application' ? draft.data.paymentId : undefined)
  if (!draft.data || (draft.data.kind === 'application' && !payment.data))
    return (
      <QueryState
        loading={draft.isLoading || payment.isLoading}
        error={draft.error || payment.error}
        retry={() => {
          void draft.refetch()
          void payment.refetch()
        }}
      />
    )
  return (
    <PaymentForm
      key={`${id}:${draft.data.attempted}`}
      draft={draft.data}
      payment={draft.data.kind === 'application' ? payment.data : undefined}
    />
  )
}
function PaymentForm({ payment, draft: source }: { payment?: Payment; draft?: PaymentDraft }) {
  const base = useBase(),
    preview = Boolean(base),
    { principal } = useAuth(),
    navigate = useNavigate(),
    invalidate = useInvalidatePayments()
  const [params] = useSearchParams(),
    credit = Boolean(payment)
  const [id] = useState(() => source?.payload.id || crypto.randomUUID())
  const [customerId, setCustomerId] = useState(
    payment?.customer_id ||
      (source?.kind === 'receipt' ? source.payload.customer_id : '') ||
      params.get('customer_id') ||
      '',
  )
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(
    source
      ? { id: customerId, name: source.customerName }
      : payment
        ? { id: customerId, name: payment.customer_name }
        : null,
  )
  const account = useAccount(customerId),
    orders = useCustomerOrders(customerId)
  const [search, setSearch] = useState('')
  const accounts = useQuery({
    queryKey: ['account-picker', principal?.organization_id, principal?.user_id, search],
    queryFn: ({ signal }) =>
      request<Page<CustomerAccount>>(`/customer-accounts?q=${encodeURIComponent(search)}`, {
        signal,
      }),
    enabled: !preview && !credit,
  })
  const selected =
    chosen ||
    (account.data ? { id: account.data.customer_id, name: account.data.customer_name } : null)
  const [amount, setAmount] = useState(source?.kind === 'receipt' ? source.payload.amount : '')
  const [date, setDate] = useState(
    source
      ? source.kind === 'receipt'
        ? source.payload.payment_date
        : source.payload.application_date
      : localToday(),
  )
  const [description, setDescription] = useState(source?.payload.description || '')
  const [apply, setApply] = useState(
    credit ||
      (source ? Boolean(source.payload.allocations.length) : params.get('mode') !== 'advance'),
  )
  const [lines, setLines] = useState<Line[]>(
    source?.payload.allocations.map((line) => ({
      ...line,
      key: crypto.randomUUID(),
      product: '',
      manual: true,
    })) || [
      { key: crypto.randomUUID(), product: '', order_id: params.get('order_id') || '', amount: '' },
    ],
  )
  const [draft, setDraft] = useState(source || null),
    [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const locked = Boolean(draft?.attempted),
    unavailable =
      !locked &&
      (Boolean(payment?.voided_at) || (credit && new Exact(payment!.available_credit).lte(0)))
  const max = credit ? payment!.available_credit : amount
  const effectiveLines = lines.map((line) => {
    if (credit || lines.length !== 1 || line.manual || !amountSchema.safeParse(max).success)
      return line
    const order = orders.data?.find((entry) => entry.id === line.order_id)
    return order ? { ...line, amount: Exact.min(max, orderRemaining(order)).toFixed(8) } : line
  })
  const allocated = sum(
    (apply ? effectiveLines : []).map((line) =>
      amountSchema.safeParse(line.amount).success ? canonicalDecimal(line.amount) : '0',
    ),
  )
  const remaining = amountSchema.safeParse(max).success
    ? new Exact(canonicalDecimal(max)).minus(allocated).toFixed(8)
    : '0'
  const save = useMutation({
    mutationFn: async () => {
      if (!principal || preview) throw new Error('Se requiere una sesión autorizada.')
      let pending = locked ? draft : null
      if (!pending) {
        const allocations = apply
          ? effectiveLines.map(({ order_id, amount: lineAmount }) => ({
              order_id,
              amount: canonicalDecimal(lineAmount),
            }))
          : []
        const parsed = paymentSchema.safeParse({
          id,
          customer_id: customerId,
          amount: canonicalDecimal(max),
          payment_date: date,
          description: description.trim() || null,
          allocations,
        })
        if (!parsed.success) throw new Error(parsed.error.issues[0].message)
        if (apply && !allocations.length)
          throw new Error('Selecciona al menos un pedido o guarda el cobro como anticipo.')
        if (!civilDate.safeParse(date).success) throw new Error('Selecciona una fecha válida.')
        for (const line of allocations) {
          const order = orders.data?.find((entry) => entry.id === line.order_id)
          if (order && new Exact(line.amount).gt(orderRemaining(order)))
            throw new Error('El importe aplicado supera el saldo del pedido seleccionado.')
        }
        pending = await retainPayment(
          principal,
          credit
            ? {
                kind: 'application',
                paymentId: payment!.id,
                payload: {
                  id,
                  application_date: date,
                  description: description.trim() || null,
                  allocations,
                },
              }
            : { kind: 'receipt', payload: parsed.data },
          selected?.name || 'Cliente',
        )
        setDraft(pending)
      }
      if (!localWorkspace && !navigator.onLine) return null
      // Once sent, the same UUID and body are reused even when the response is lost.
      setDraft({ ...pending, attempted: true })
      return commitPayment(principal, pending)
    },
    onSuccess: async (record) => {
      setDirty(false)
      await invalidate()
      navigate(record ? `/cobros/${record.id}` : '/sincronizacion', {
        state: record ? { saved: true } : { queued: true },
      })
    },
  })
  const reopen = useMutation({
    mutationFn: async () => {
      if (draft && principal) await reopenPayment(principal, draft)
    },
    onSuccess: async () => {
      if (draft) setDraft({ ...draft, attempted: false })
      await invalidate()
    },
  })
  useUnsavedCapture(dirty && !draft)
  function update(key: string, patch: Partial<Line>) {
    setLines((rows) => rows.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }
  function chooseOrder(key: string, orderId: string) {
    const order = orders.data?.find((entry) => entry.id === orderId)
    const row = effectiveLines.find((line) => line.key === key)
    const other = allocated.minus(
      amountSchema.safeParse(row?.amount || '').success ? row!.amount : '0',
    )
    const available = amountSchema.safeParse(max).success
      ? Exact.max(0, new Exact(max).minus(other))
      : new Exact(0)
    update(key, {
      order_id: orderId,
      amount: order ? Exact.min(orderRemaining(order), available).toFixed(8) : '',
      manual: false,
    })
  }
  return (
    <>
      <Link className="back-link" to={payment ? `/cobros/${payment.id}` : `${base}/cobros`}>
        Volver a cobros
      </Link>
      <PageHeader
        eyebrow={credit ? 'USAR SALDO A FAVOR' : 'DINERO RECIBIDO'}
        title={credit ? 'Aplicar saldo a pedidos' : 'Registrar cobro'}
        description={
          credit
            ? 'Esta aplicación usa dinero ya recibido del cliente.'
            : 'Elige si es un abono a pedidos o un anticipo para el cliente.'
        }
      />
      <div className="order-grid">
        <form
          className="panel form-panel"
          noValidate
          onChange={() => setDirty(true)}
          onSubmit={(event) => {
            event.preventDefault()
            setError('')
            if (!save.isPending) save.mutate()
          }}
        >
          <fieldset disabled={preview || locked || save.isPending || unavailable}>
            <div className="field">
              <label id="payment-customer-label" htmlFor="payment-customer">
                Cliente
              </label>
              <CustomerSelect
                id="payment-customer"
                selected={selected}
                search={search}
                onSearch={setSearch}
                onSelect={(choice) => {
                  setChosen(choice)
                  setCustomerId(choice.id)
                  setLines([{ key: crypto.randomUUID(), product: '', order_id: '', amount: '' }])
                  setDirty(true)
                }}
                onBlur={() => undefined}
                fieldRef={() => undefined}
                results={
                  accounts.data
                    ? {
                        total: accounts.data.total,
                        items: accounts.data.items.map((entry) => ({
                          id: entry.customer_id,
                          name: entry.customer_name,
                        })),
                      }
                    : undefined
                }
                loading={accounts.isLoading}
                error={accounts.error}
                onRetry={() => void accounts.refetch()}
                disabled={credit || locked || preview || save.isPending}
                invalid={false}
              />
              {credit && <p className="field-hint">El saldo pertenece a este cliente.</p>}
            </div>
            {!credit && (
              <fieldset className="payment-purpose">
                <legend>¿Qué estás registrando?</legend>
                <label className={`purpose-choice ${apply ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="payment-purpose"
                    value="orders"
                    checked={apply}
                    onChange={() => setApply(true)}
                    aria-labelledby="purpose-orders-title"
                    aria-describedby="purpose-orders-hint"
                  />
                  <span>
                    <strong id="purpose-orders-title">Abono a pedidos</strong>
                    <small id="purpose-orders-hint">
                      Selecciona los pedidos y cuánto pagó de cada uno.
                    </small>
                  </span>
                </label>
                <label className={`purpose-choice ${!apply ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="payment-purpose"
                    value="advance"
                    checked={!apply}
                    onChange={() => setApply(false)}
                    aria-labelledby="purpose-advance-title"
                    aria-describedby="purpose-advance-hint"
                  />
                  <span>
                    <strong id="purpose-advance-title">Anticipo / saldo a favor</strong>
                    <small id="purpose-advance-hint">
                      Guarda el dinero para abonar pedidos después.
                    </small>
                  </span>
                </label>
              </fieldset>
            )}
            {!credit && (
              <div className="field">
                <label htmlFor="payment-amount">Monto recibido (MXN)</label>
                <NumberInput
                  id="payment-amount"
                  value={amount}
                  onChange={(value) => {
                    setAmount(value)
                    if (lines.length === 1 && !lines[0].manual) {
                      const order = orders.data?.find((entry) => entry.id === lines[0].order_id)
                      if (order)
                        update(lines[0].key, {
                          amount: amountSchema.safeParse(value).success
                            ? Exact.min(value, orderRemaining(order)).toFixed(8)
                            : '',
                        })
                    }
                    setDirty(true)
                  }}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="payment-date">
                {credit ? 'Fecha de aplicación' : 'Fecha del pago'}
              </label>
              <input
                id="payment-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="payment-description">Descripción del pago</label>
              <textarea
                id="payment-description"
                rows={3}
                maxLength={4000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {apply && (
              <div className="allocation-list">
                <h2>Pedidos que se abonan</h2>
                <QueryState
                  loading={Boolean(customerId) && orders.isLoading}
                  error={orders.error}
                  retry={() => void orders.refetch()}
                />
                {effectiveLines.map((line, index) => {
                  const order = orders.data?.find((entry) => entry.id === line.order_id)
                  const options = (orders.data || []).filter(
                    (entry) =>
                      entry.id === line.order_id ||
                      (entry.remission_number &&
                        new Exact(orderRemaining(entry)).gt(0) &&
                        (!line.product || entry.product_type === line.product)),
                  )
                  return (
                    <div className="allocation-row" key={line.key}>
                      <div className="field">
                        <label htmlFor={`product-${line.key}`}>Producto {index + 1}</label>
                        <select
                          id={`product-${line.key}`}
                          value={line.product || order?.product_type || ''}
                          onChange={(event) =>
                            update(line.key, {
                              product: event.target.value,
                              order_id: '',
                              amount: '',
                            })
                          }
                        >
                          <option value="">Todos los productos</option>
                          <option value="carrot">Zanahoria</option>
                          <option value="potato">Papa</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`order-${line.key}`}>Pedido {index + 1}</label>
                        <select
                          id={`order-${line.key}`}
                          value={line.order_id}
                          onChange={(event) => chooseOrder(line.key, event.target.value)}
                        >
                          <option value="">Selecciona un pedido</option>
                          {options.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {orderLabel(entry)} · Debe {money(orderRemaining(entry))}
                            </option>
                          ))}
                          {!order && line.order_id && (
                            <option value={line.order_id}>
                              Pedido de la captura · {line.order_id}
                            </option>
                          )}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`remission-${line.key}`}>Remisión {index + 1}</label>
                        <input
                          id={`remission-${line.key}`}
                          readOnly
                          value={order?.remission_number || ''}
                          placeholder="Del pedido seleccionado"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`allocation-${line.key}`}>
                          Monto aplicado {index + 1} (MXN)
                        </label>
                        <NumberInput
                          id={`allocation-${line.key}`}
                          value={line.amount}
                          onChange={(value) => {
                            update(line.key, { amount: value, manual: true })
                            setDirty(true)
                          }}
                        />
                      </div>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() =>
                          setLines(effectiveLines.filter((entry) => entry.key !== line.key))
                        }
                      >
                        Quitar pedido {index + 1}
                      </button>
                    </div>
                  )
                })}
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={lines.length >= 100 || !customerId}
                  onClick={() =>
                    setLines([
                      ...effectiveLines,
                      { key: crypto.randomUUID(), product: '', order_id: '', amount: '' },
                    ])
                  }
                >
                  Agregar otro pedido
                </button>
                <p className="field-hint">
                  Solo aparecen pedidos con remisión y saldo pendiente de este cliente. Completa la
                  remisión desde Editar pedido si falta.
                </p>
              </div>
            )}
          </fieldset>
          {unavailable && (
            <p className="field-error" role="alert">
              Este cobro está anulado o no tiene saldo a favor disponible.
            </p>
          )}
          {(save.error || error || reopen.error) && (
            <p className="field-error" role="alert">
              {save.error?.message || reopen.error?.message || error}
            </p>
          )}
          {draft && (
            <div className="notice">
              <p>
                La captura se conserva en este dispositivo. Al reintentar se usará el mismo
                identificador para evitar duplicados.
              </p>
              {locked && (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={reopen.isPending}
                  onClick={() => reopen.mutate()}
                >
                  Comprobar y habilitar corrección
                </button>
              )}
            </div>
          )}
          <div className="form-actions">
            <button
              className="button button-primary"
              disabled={preview || save.isPending || unavailable}
              type="submit"
            >
              {save.isPending
                ? 'Guardando…'
                : locked
                  ? 'Reintentar guardado'
                  : credit
                    ? 'Aplicar saldo a favor'
                    : 'Guardar cobro'}
            </button>
            <ActionLink secondary to={`${base}/cobros`}>
              Volver
            </ActionLink>
          </div>
        </form>
        <aside className="panel order-summary">
          <p className="eyebrow">{credit ? 'SALDO DISPONIBLE DEL COBRO' : 'RESUMEN DEL COBRO'}</p>
          <h2>{selected?.name || 'Selecciona un cliente'}</h2>
          <dl className="payment-balances">
            <div>
              <dt>{credit ? 'Disponible para aplicar' : 'Dinero recibido'}</dt>
              <dd>{money(amountSchema.safeParse(max).success ? max : '0')}</dd>
            </div>
            <div>
              <dt>Abonado a pedidos</dt>
              <dd>{money(allocated.toFixed(8))}</dd>
            </div>
            <div>
              <dt>Saldo a favor restante</dt>
              <dd>{money(remaining)}</dd>
            </div>
          </dl>
          <p className="field-hint">
            El excedente queda a favor de este cliente. Puedes aplicarlo después a uno o varios
            pedidos.
          </p>
        </aside>
      </div>
    </>
  )
}

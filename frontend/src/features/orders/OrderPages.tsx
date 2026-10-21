import { useState } from 'react'
import { groupNumber } from '../../lib/number-format'
import { z } from 'zod'
import { useUnsavedCapture } from '../../lib/useUnsavedCapture'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  Plus,
  Search,
  ClipboardList,
  ArrowLeft,
  Download,
  RefreshCw,
  Paperclip,
} from 'lucide-react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ActionLink, Badge, EmptyState, PageHeader } from '../../components/ui'
import { QueryState } from '../../components/QueryState'
import { DeleteRecordButton } from '../../components/DeleteRecordButton'
import { useBase } from '../../app/useBase'
import { useAuth } from '../auth/AuthProvider'
import { localWorkspace } from '../../lib/env'
import { fileTypeLabel } from '../../lib/attachment-policy'
import {
  request,
  downloadAttachment,
  type Customer,
  type Order,
  type Page,
} from '../../lib/business-api'
import { products, CarrotFields, type ProductType } from './products'
import { PotatoFields, PotatoDetail } from './PotatoFields'
import {
  previewPotato,
  emptyPotato,
  potatoPayload,
  potatoSchema,
  type PotatoInput,
} from './potato-domain'
import {
  carrotSchema,
  canonicalDecimal,
  totalFor,
  money,
  quantity,
  dateLabel,
  localToday,
  type CarrotValues,
} from './domain'
import { FilePicker } from './FilePicker'
import { CustomerSelect } from '../customers/CustomerSelect'
import { Exact, remissionSchema, orderPaid, orderRemaining } from '../payments/domain'
import {
  commitDraft,
  prepareFiles,
  retainDraft,
  retainFiles,
  uploadRetained,
  type PendingDraft,
  type SelectedFile,
  getPendingDraft,
  getRetainedFiles,
  reopenOrderCreation,
} from './pending-files'

export function OrdersPage() {
  const location = useLocation()
  const base = useBase(),
    preview = Boolean(base),
    { principal } = useAuth()
  const [search, setSearch] = useState(''),
    [product, setProduct] = useState(''),
    [offset, setOffset] = useState(0)
  const query = useQuery({
    queryKey: ['orders', principal?.organization_id, principal?.user_id, search, product, offset],
    queryFn: () =>
      request<Page<Order>>(
        `/orders?q=${encodeURIComponent(search)}&offset=${offset}${product ? `&product_type=${product}` : ''}`,
      ),
    enabled: !preview,
  })
  return (
    <>
      <PageHeader
        eyebrow="DEL CAMPO A TUS CLIENTES"
        title="Tus pedidos"
        description="Cada operación, con sus detalles en un mismo lugar."
        action={
          <ActionLink to={`${base}/pedidos/nuevo`}>
            <Plus size={17} />
            Nuevo pedido
          </ActionLink>
        }
      />
      {location.state?.deleted && (
        <div className="notice" role="status">
          <p>Pedido eliminado.</p>
        </div>
      )}
      <section className="panel list-panel">
        <div className="list-toolbar">
          <h2>Registro de pedidos</h2>
          <div className="list-filters">
            <label className="search-box">
              <Search size={18} />
              <input
                type="search"
                aria-label="Buscar pedidos por cliente"
                placeholder="Cliente o remisión"
                value={search}
                disabled={preview}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setOffset(0)
                }}
              />
            </label>
            <select
              aria-label="Filtrar por producto"
              value={product}
              disabled={preview}
              onChange={(event) => {
                setProduct(event.target.value)
                setOffset(0)
              }}
            >
              <option value="">Todos los productos</option>
              <option value="carrot">Zanahoria</option>
              <option value="potato">Papa</option>
            </select>
          </div>
        </div>
        {!preview && (
          <QueryState
            loading={query.isLoading}
            error={query.error}
            retry={() => void query.refetch()}
          />
        )}
        {(preview || query.data?.total === 0) && (
          <EmptyState
            icon={ClipboardList}
            title="Cada pedido tiene su historia"
            description={
              preview
                ? 'Explora el formulario de zanahoria. Para guardar y consultar pedidos, ingresa con una cuenta autorizada.'
                : 'Todavía no hay pedidos que coincidan con tu búsqueda. Registra una operación para comenzar.'
            }
            action={
              <ActionLink secondary to={`${base}/pedidos/nuevo`}>
                Nuevo pedido
              </ActionLink>
            }
          />
        )}
        {query.data && (
          <>
            <div className="record-list">
              {query.data.items.map((order) => (
                <Link className="record-row order-row" key={order.id} to={`/pedidos/${order.id}`}>
                  <span className="card-icon peach">
                    <ClipboardList size={21} />
                  </span>
                  <div className="record-copy">
                    <h3>{order.customer_name}</h3>
                    <p>
                      {order.remission_number
                        ? `Remisión ${order.remission_number} · `
                        : 'Sin remisión · '}
                      {products[order.product_type].label} · {dateLabel(order.order_date)} ·{' '}
                      {order.product_type === 'carrot'
                        ? `${quantity(order.hectares)} ha`
                        : `${quantity(order.potato.total_quantity)} de cantidad total`}
                    </p>
                    <Badge tone={order.attachment_status === 'pending' ? 'amber' : 'green'}>
                      {order.attachment_status === 'pending'
                        ? 'Archivos pendientes'
                        : localWorkspace
                          ? 'Guardado en este navegador'
                          : 'Guardado en servidor'}
                    </Badge>
                  </div>
                  <strong className="record-amount">{money(order.total_amount)}</strong>
                </Link>
              ))}
            </div>
            <div className="pagination">
              <span>{groupNumber(String(query.data.total))} pedidos</span>
              <button
                className="button button-secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 30))}
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
          </>
        )}
      </section>
    </>
  )
}

export function EditOrderFormPage() {
  const { id } = useParams(),
    { principal } = useAuth()
  const preview = Boolean(useBase())
  const query = useQuery({
    queryKey: ['order', principal?.organization_id, principal?.user_id, id],
    queryFn: () => request<Order>(`/orders/${id}`),
    enabled: !preview,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  // Freeze the edit snapshot only after the first fresh read, never from stale query data.
  if (query.isSuccess && query.isFetchedAfterMount)
    return <OrderFormPage key={query.data.id} initialOrder={query.data} />
  return (
    <>
      <PageHeader
        eyebrow="PEDIDO DE ZANAHORIA"
        title="Editar pedido"
        description="Carga la información del pedido para modificarla."
      />
      <QueryState
        loading={query.isLoading || query.isFetching}
        error={query.error}
        retry={() => void query.refetch()}
      />
    </>
  )
}

export function PendingOrderFormPage() {
  const { id } = useParams(),
    { principal } = useAuth()
  const query = useQuery({
    queryKey: ['pending-editor', principal?.organization_id, principal?.user_id, id],
    queryFn: async () => {
      const draft = await getPendingDraft(principal!, id!)
      if (!draft) throw new Error('Esta captura ya se envió o no está disponible para esta cuenta.')
      const records = await getRetainedFiles(principal!, id!)
      const existing = new Set(draft.baseOrder?.attachments.map((file) => file.id) || [])
      const wanted = new Set(draft.payload.attachments.map((file) => file.id))
      return {
        draft,
        files: records.filter(
          (file) => wanted.has(file.manifest.id) && !existing.has(file.manifest.id),
        ),
      }
    },
    enabled: Boolean(principal),
  })
  if (query.data)
    return (
      <OrderFormPage
        key={id}
        initialOrder={query.data.draft.baseOrder}
        initialDraft={query.data.draft}
        initialFiles={query.data.files}
      />
    )
  return (
    <>
      <PageHeader
        eyebrow="CAPTURA LOCAL"
        title="Abrir borrador"
        description="Recupera los datos y archivos guardados en este dispositivo."
      />
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
    </>
  )
}

export function OrderFormPage({
  initialOrder: incomingOrder,
  initialDraft,
  initialFiles = [],
}: { initialOrder?: Order; initialDraft?: PendingDraft; initialFiles?: SelectedFile[] } = {}) {
  const [initialOrder] = useState(incomingOrder)
  const source = initialDraft?.payload
  const base = useBase(),
    preview = Boolean(base),
    { principal } = useAuth(),
    navigate = useNavigate(),
    cache = useQueryClient()
  const [product, setProduct] = useState<ProductType>(
      source?.product_type || initialOrder?.product_type || 'carrot',
    ),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<Pick<Customer, 'id' | 'name'> | null>(
      source
        ? {
            id: source.customer_id,
            name:
              initialDraft?.customerName || initialOrder?.customer_name || 'Cliente de la captura',
          }
        : initialOrder
          ? { id: initialOrder.customer_id, name: initialOrder.customer_name }
          : null,
    )
  const [removed, setRemoved] = useState<string[]>(
    (initialOrder?.attachments || [])
      .filter((file) => source && !source.attachments.some((manifest) => manifest.id === file.id))
      .map((file) => file.id),
  )
  const kept = (initialOrder?.attachments || []).filter((file) => !removed.includes(file.id))
  const [files, setFiles] = useState<SelectedFile[]>(initialFiles),
    [draft, setDraft] = useState<PendingDraft | null>(
      initialDraft && initialDraft.attempted !== false ? initialDraft : null,
    ),
    [recordId] = useState(() => initialDraft?.orderId || crypto.randomUUID())
  const form = useForm<CarrotValues>({
    resolver: zodResolver(
      (product === 'carrot'
        ? carrotSchema
        : carrotSchema.extend({ hectares: z.string(), unit_price: z.string() })
      ).superRefine((values, context) => {
        if (draft && !draft.payload.remission_number && !values.remission_number) return
        const result = remissionSchema.safeParse(values.remission_number || '')
        if (!result.success)
          context.addIssue({
            code: 'custom',
            path: ['remission_number'],
            message: result.error.issues[0].message,
          })
      }),
    ),
    defaultValues: {
      customer_id: source?.customer_id || initialOrder?.customer_id || '',
      remission_number: String(source?.remission_number || initialOrder?.remission_number || ''),
      order_date: source?.order_date || initialOrder?.order_date || localToday(),
      unit_price:
        source?.product_type === 'carrot'
          ? source.details.unit_price
          : initialOrder?.unit_price || '',
      hectares:
        source?.product_type === 'carrot' ? source.details.hectares : initialOrder?.hectares || '',
      description: source ? source.description || '' : initialOrder?.description || '',
    },
  })
  const potatoForm = useForm<PotatoInput>({
    resolver: zodResolver(potatoSchema),
    defaultValues:
      source?.product_type === 'potato'
        ? source.details
        : initialOrder?.product_type === 'potato'
          ? {
              gross_weight: initialOrder.potato.gross_weight,
              tare_weight: initialOrder.potato.tare_weight,
              additional_shrinkage: initialOrder.potato.additional_shrinkage,
              shrinkage_override: initialOrder.potato.shrinkage_override ?? null,
              lines: initialOrder.potato.lines.map(({ grade_code, quantity, unit_price }) => ({
                grade_code,
                quantity,
                unit_price,
              })),
            }
          : emptyPotato(),
  })
  const potatoCalculated = previewPotato(potatoForm.watch())
  const customers = useQuery({
    queryKey: ['customer-picker', principal?.organization_id, search],
    queryFn: ({ signal }) =>
      request<Page<Customer>>(`/customers?active=true&q=${encodeURIComponent(search)}`, { signal }),
    enabled: !preview,
  })
  const total =
    product === 'carrot'
      ? totalFor(form.watch('hectares'), form.watch('unit_price'))
      : potatoCalculated?.total_amount || null
  const save = useMutation({
    mutationFn: async (values: CarrotValues) => {
      if (!principal || preview) throw new Error('Se requiere una sesión autorizada.')
      const pending =
        draft ||
        (await retainDraft(
          principal,
          {
            ...(initialDraft?.operation === 'update' && 'expected_version' in initialDraft.payload
              ? { expected_version: initialDraft.payload.expected_version }
              : initialOrder
                ? { expected_version: initialOrder.version }
                : { id: recordId }),
            customer_id: values.customer_id,
            remission_number: Number(values.remission_number),
            ...(product === 'carrot'
              ? {
                  product_type: 'carrot' as const,
                  details: {
                    hectares: canonicalDecimal(values.hectares),
                    unit_price: canonicalDecimal(values.unit_price),
                  },
                }
              : {
                  product_type: 'potato' as const,
                  details: potatoPayload(potatoForm.getValues()),
                }),
            order_date: values.order_date,
            description: values.description.trim() || null,
            attachments: [
              ...kept.map(({ id, filename, size_bytes, sha256 }) => ({
                id,
                filename,
                size_bytes,
                sha256,
              })),
              ...files.map((file) => file.manifest),
            ],
          },
          files,
          initialOrder?.id,
          { customerName: selected?.name, baseOrder: initialOrder },
        ))
      setDraft(pending)
      if (!localWorkspace && !navigator.onLine) return { order: null, failures: 0 }
      return commitDraft(principal, pending)
    },
    onSuccess: async ({ order, failures }) => {
      if (!order) {
        await cache.invalidateQueries({ queryKey: ['pending'] })
        navigate('/sincronizacion', { state: { queued: true } })
        return
      }
      await cache.invalidateQueries({ queryKey: ['orders'] })
      await cache.invalidateQueries({ queryKey: ['order'] })
      await cache.invalidateQueries({ queryKey: ['accounts'] })
      navigate(`/pedidos/${order.id}`, { state: { saved: true, pending: failures } })
    },
  })
  const locked = save.isPending || Boolean(draft)
  const reopen = useMutation({
    mutationFn: async () => {
      if (principal && draft) await reopenOrderCreation(principal, draft)
    },
    onSuccess: () => {
      setDraft(null)
      save.reset()
    },
  })
  const [filesBusy, setFilesBusy] = useState(false)
  useUnsavedCapture(
    !draft &&
      (files.length > 0 ||
        removed.length > 0 ||
        form.formState.isDirty ||
        potatoForm.formState.isDirty ||
        product !== (source?.product_type || initialOrder?.product_type || 'carrot')),
  )
  return (
    <>
      <Link
        className="back-link"
        to={initialOrder ? `/pedidos/${initialOrder.id}` : `${base}/pedidos`}
      >
        <ArrowLeft size={16} />
        Volver a pedidos
      </Link>
      <PageHeader
        eyebrow="UNA NUEVA OPERACIÓN"
        title={
          initialOrder
            ? `Editar pedido de ${products[product].label.toLowerCase()}`
            : 'Del campo, con claridad.'
        }
        description={
          initialOrder
            ? 'Actualiza los datos y guarda los cambios.'
            : 'Registra tus pedidos de zanahoria y papa.'
        }
      />
      {preview && (
        <div className="notice">
          <p>
            Prueba la fecha, el cálculo y la selección de archivos. El guardado requiere una sesión
            autorizada.
          </p>
        </div>
      )}
      <div className="order-grid">
        <form
          className="panel form-panel"
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            if (product === 'potato' && !(await potatoForm.trigger())) return
            if (!preview && !save.isPending) save.mutate(values)
          })}
        >
          <div className="panel-heading">
            <h2>Detalles del pedido</h2>
            <Badge tone="green">
              {product === 'carrot' ? 'MXN · Hectáreas' : 'MXN · Clasificaciones'}
            </Badge>
          </div>
          <fieldset disabled={locked}>
            <div className="field">
              <label htmlFor="remission-number">Número de remisión</label>
              <input
                id="remission-number"
                inputMode="numeric"
                aria-describedby="remission-error"
                {...form.register('remission_number')}
              />
              <p id="remission-error" className="field-error">
                {form.formState.errors.remission_number?.message}
              </p>
              <p className="field-hint">
                Número entero único entre los pedidos vigentes de este producto. Puedes reutilizar
                el de un pedido eliminado o usar el mismo número en el otro producto.
              </p>
            </div>
            <div className="field">
              <label id="order-customer-label" htmlFor="order-customer">
                Nombre del cliente
              </label>
              <Controller
                name="customer_id"
                control={form.control}
                render={({ field, fieldState }) => (
                  <CustomerSelect
                    id="order-customer"
                    selected={selected}
                    search={search}
                    onSearch={setSearch}
                    onSelect={(customer) => {
                      setSelected(customer)
                      field.onChange(customer.id)
                    }}
                    onBlur={field.onBlur}
                    fieldRef={field.ref}
                    results={customers.data}
                    loading={customers.isLoading}
                    error={customers.error}
                    onRetry={() => void customers.refetch()}
                    disabled={preview || locked}
                    invalid={fieldState.invalid}
                  />
                )}
              />
              <p id="customer-error" className="field-error">
                {form.formState.errors.customer_id?.message}
              </p>
              <Link className="subtle-link customer-create-link" to={`${base}/clientes/nuevo`}>
                <Plus size={15} />
                Dar de alta cliente
              </Link>
            </div>
            <div className="field">
              <label htmlFor="product">Producto</label>
              <select
                id="product"
                value={product}
                onChange={(event) => setProduct(event.target.value as ProductType)}
              >
                {Object.entries(products).map(([key, item]) => (
                  <option key={key} value={key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            {
              <div className="field">
                <label htmlFor="order-date">Fecha del pedido</label>
                <input
                  id="order-date"
                  type="date"
                  aria-invalid={Boolean(form.formState.errors.order_date)}
                  aria-describedby="date-error"
                  {...form.register('order_date')}
                />
                <p id="date-error" className="field-error">
                  {form.formState.errors.order_date?.message}
                </p>
              </div>
            }
            <div className="field">
              <label htmlFor="description">
                Descripción <span className="optional">Opcional</span>
              </label>
              <textarea
                id="description"
                rows={4}
                placeholder="Escribe los detalles de este pedido"
                aria-describedby="description-error"
                {...form.register('description')}
              />
              <p id="description-error" className="field-error">
                {form.formState.errors.description?.message}
              </p>
            </div>
            {product === 'carrot' ? (
              <CarrotFields form={form} disabled={locked} />
            ) : (
              <PotatoFields form={potatoForm} />
            )}
            {
              <>
                <div className="field">
                  <label htmlFor="order-total">Precio total</label>
                  <input
                    id="order-total"
                    readOnly
                    value={total === null ? '' : money(total)}
                    placeholder="Se calcula automáticamente"
                  />
                  <p className="field-hint">
                    {product === 'carrot'
                      ? 'Cantidad de hectáreas × precio unitario por hectárea.'
                      : 'Suma de los importes calculados por clasificación.'}
                  </p>
                </div>
                {initialOrder && initialOrder.attachments.length > 0 && (
                  <div className="existing-attachments">
                    <h3>Archivos actuales</h3>
                    {initialOrder.attachments.map((attachment) => (
                      <label className="attachment-remove" key={attachment.id}>
                        <input
                          type="checkbox"
                          checked={removed.includes(attachment.id)}
                          aria-label={`Retirar ${attachment.filename}`}
                          onChange={(event) =>
                            setRemoved((ids) =>
                              event.target.checked
                                ? [...ids, attachment.id]
                                : ids.filter((id) => id !== attachment.id),
                            )
                          }
                        />
                        <span>Retirar {attachment.filename}</span>
                      </label>
                    ))}
                    <p className="field-hint">
                      Los archivos marcados se retirarán al guardar los cambios.
                    </p>
                  </div>
                )}
                <FilePicker
                  files={files}
                  onChange={setFiles}
                  onBusy={setFilesBusy}
                  disabled={locked}
                  existing={kept}
                />
              </>
            }
          </fieldset>
          {save.error && (
            <div role="alert" className="field-error">
              <p>{save.error.message}</p>
              {draft && (
                <p>
                  La captura y sus archivos se conservan en este dispositivo. Reintenta aquí o desde
                  Envíos pendientes con la misma cuenta.
                </p>
              )}
            </div>
          )}
          {draft && draft.operation !== 'update' && (
            <div className="notice">
              <p>
                Para corregir la remisión u otro dato, comprueba primero si este pedido llegó a
                guardarse.
              </p>
              <button
                type="button"
                className="button button-secondary"
                disabled={reopen.isPending || save.isPending}
                onClick={() => reopen.mutate()}
              >
                Comprobar y corregir captura
              </button>
            </div>
          )}
          {reopen.error && (
            <p role="alert" className="field-error">
              {reopen.error.message}
            </p>
          )}
          <div className="form-actions">
            <Link
              className="button button-secondary"
              to={initialOrder ? `/pedidos/${initialOrder.id}` : `${base}/pedidos`}
            >
              Volver
            </Link>
            <button
              className="button button-primary"
              type="submit"
              disabled={preview || save.isPending || filesBusy || !products[product].enabled}
            >
              {save.isPending
                ? 'Guardando pedido y archivos…'
                : draft
                  ? 'Reintentar guardado'
                  : initialOrder
                    ? 'Guardar cambios'
                    : 'Guardar pedido'}
            </button>
          </div>
        </form>
        <aside className="panel order-summary">
          <p className="eyebrow">RESUMEN DEL PEDIDO</p>
          <h2>{products[product].label}</h2>
          <dl>
            <div>
              <dt>Cliente</dt>
              <dd>{selected?.name || 'Por seleccionar'}</dd>
            </div>
            <div>
              <dt>Fecha</dt>
              <dd>{form.watch('order_date') || 'Por seleccionar'}</dd>
            </div>
            <div>
              <dt>Archivos</dt>
              <dd>{groupNumber(String(files.length + kept.length))}</dd>
            </div>
          </dl>
          <div className="summary-total">
            <span>Total calculado</span>
            <strong aria-live="polite">{total !== null ? money(total) : 'Pendiente'}</strong>
            <small>
              {product === 'carrot'
                ? 'Hectáreas × precio unitario por hectárea'
                : 'Suma de importes · MXN'}
            </small>
          </div>
          {product === 'potato' && (
            <dl className="potato-summary">
              <div>
                <dt>CANTIDAD TOTAL</dt>
                <dd>
                  {potatoCalculated.total_quantity !== undefined
                    ? quantity(potatoCalculated.total_quantity)
                    : 'Pendiente'}
                </dd>
              </div>
              <div>
                <dt>PESO NETO TOTAL</dt>
                <dd>
                  {potatoCalculated.net_total_weight !== undefined
                    ? quantity(potatoCalculated.net_total_weight)
                    : 'Pendiente'}
                </dd>
              </div>
            </dl>
          )}
          <p className="field-hint">
            La fecha del pedido es independiente de la fecha en que se registra. Conservamos los
            decimales del cálculo.
          </p>
        </aside>
      </div>
    </>
  )
}

export function OrderDetailPage() {
  const navigate = useNavigate()
  const base = useBase(),
    preview = Boolean(base),
    { id } = useParams(),
    { principal } = useAuth(),
    location = useLocation(),
    cache = useQueryClient()
  const [fileError, setFileError] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['order', principal?.organization_id, principal?.user_id, id],
    queryFn: () => request<Order>(`/orders/${id}`),
    enabled: !preview,
  })
  const retry = useMutation({
    mutationFn: async () => {
      if (!principal || !id) return
      const failures = await uploadRetained(principal, id)
      if (failures) throw new Error('Algunos archivos siguen pendientes. Puedes volver a intentar.')
    },
    onSettled: () => {
      void query.refetch()
      void cache.invalidateQueries({ queryKey: ['orders'] })
    },
  })
  async function restore(attachment: Order['attachments'][number], file: File | undefined) {
    if (!file || !principal || !id) return
    setFileError(null)
    try {
      const [selected] = await prepareFiles([file])
      if (
        selected.manifest.sha256 !== attachment.sha256 ||
        selected.manifest.size_bytes !== attachment.size_bytes
      )
        throw new Error('Selecciona el mismo archivo que adjuntaste originalmente.')
      await retainFiles(principal, id, [{ blob: file, manifest: attachment }])
      retry.mutate()
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : 'No se pudo recuperar el archivo.')
    }
  }
  if (preview)
    return (
      <>
        <PageHeader
          eyebrow="REGISTRO DE OPERACIONES"
          title="Detalle del pedido"
          description="La trazabilidad de cada operación comienza aquí."
        />
        <section className="panel">
          <EmptyState
            icon={ClipboardList}
            title="Aún no hay un pedido para consultar"
            description="Con una sesión autorizada podrás consultar los pedidos guardados y descargar sus adjuntos privados."
            action={<ActionLink to={`${base}/pedidos`}>Ir a pedidos</ActionLink>}
          />
        </section>
      </>
    )
  const order = query.data
  return (
    <>
      <Link className="back-link" to="/pedidos">
        <ArrowLeft size={16} />
        Volver a pedidos
      </Link>
      <PageHeader
        eyebrow={
          order
            ? `PEDIDO DE ${products[order.product_type].label.toUpperCase()}`
            : 'REGISTRO DE PEDIDOS'
        }
        title={order?.customer_name || 'Detalle del pedido'}
        description={
          order
            ? `Fecha del pedido: ${dateLabel(order.order_date)}`
            : 'Consulta de una operación guardada.'
        }
        action={
          order ? (
            <div className="record-actions">
              <ActionLink secondary to={`/pedidos/${order.id}/editar`}>
                Editar pedido
              </ActionLink>
              <DeleteRecordButton
                kind="order"
                id={order.id}
                version={order.version}
                name={`${order.customer_name} · ${dateLabel(order.order_date)}`}
                onDeleted={() => navigate('/pedidos', { state: { deleted: true } })}
                blockReason={
                  new Exact(orderPaid(order)).gt(0)
                    ? 'Este pedido tiene cobros vigentes. Abre sus cobros para anularlos o quitar sus abonos. Cuando no quede ningún abono vigente, podrás eliminarlo.'
                    : undefined
                }
                blockAction={
                  new Exact(orderPaid(order)).gt(0) ? (
                    <ActionLink to={`/cobros/clientes/${order.customer_id}?order_id=${order.id}`}>
                      Ver cobros asociados
                    </ActionLink>
                  ) : undefined
                }
              />
            </div>
          ) : undefined
        }
      />
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => void query.refetch()}
      />
      {order && (
        <>
          {location.state?.saved && (
            <div className="notice" role="status">
              <p>
                {localWorkspace
                  ? 'Pedido guardado en este navegador.'
                  : 'Pedido guardado en el servidor.'}
                {order.attachment_status === 'pending'
                  ? ' Algunos archivos siguen pendientes de subir.'
                  : ''}
              </p>
            </div>
          )}
          <div className="order-grid">
            <section className="panel form-panel">
              <div className="panel-heading">
                <h2>Información del pedido</h2>
                <Badge tone={order.attachment_status === 'complete' ? 'green' : 'amber'}>
                  {order.attachment_status === 'complete'
                    ? localWorkspace
                      ? 'Guardado en este navegador'
                      : 'Guardado en servidor'
                    : 'Archivos pendientes'}
                </Badge>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Número de remisión</dt>
                  <dd>{order.remission_number || 'Sin remisión'}</dd>
                </div>
                <div>
                  <dt>Nombre del cliente</dt>
                  <dd>{order.customer_name}</dd>
                </div>
                <div>
                  <dt>Producto</dt>
                  <dd>{products[order.product_type].label}</dd>
                </div>
                <div>
                  <dt>Fecha del pedido</dt>
                  <dd>{dateLabel(order.order_date)}</dd>
                </div>
                {order.product_type === 'carrot' && (
                  <>
                    <div>
                      <dt>Precio unitario por hectárea</dt>
                      <dd>{money(order.unit_price)}</dd>
                    </div>
                    <div>
                      <dt>Cantidad de hectáreas</dt>
                      <dd>{quantity(order.hectares)} ha</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Descripción</dt>
                  <dd className="description-text">{order.description || 'Sin descripción'}</dd>
                </div>
                <div>
                  <dt>Registrado el</dt>
                  <dd>
                    {new Intl.DateTimeFormat('es-MX', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(order.created_at))}
                  </dd>
                </div>
                <div>
                  <dt>Responsable</dt>
                  <dd className="identifier">
                    {order.created_by === principal?.user_id ? 'Tú' : order.created_by}
                  </dd>
                </div>
                {order.updated_at && (
                  <div>
                    <dt>Última modificación</dt>
                    <dd>
                      {new Intl.DateTimeFormat('es-MX', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(order.updated_at))}
                      {order.updated_by
                        ? ` · ${order.updated_by === principal?.user_id ? 'Tú' : order.updated_by}`
                        : ''}
                    </dd>
                  </div>
                )}
              </dl>
              {order.product_type === 'potato' && <PotatoDetail data={order.potato} />}
              <div className="file-picker-heading">
                <h3>
                  <Paperclip size={18} />
                  Archivos adjuntos
                </h3>
                <span>{order.attachments.length}</span>
              </div>
              {order.attachments.length === 0 && (
                <p className="field-hint">Este pedido no tiene archivos adjuntos.</p>
              )}
              <ul className="selected-files">
                {order.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <span className="file-symbol">
                      <Paperclip size={19} />
                    </span>
                    <div>
                      <strong>{attachment.filename}</strong>
                      <small>
                        {fileTypeLabel(attachment.filename)} ·{' '}
                        {groupNumber((attachment.size_bytes / 1024).toFixed(1))} KB ·{' '}
                        {attachment.status === 'ready'
                          ? localWorkspace
                            ? 'Guardado en este navegador'
                            : 'Guardado en servidor'
                          : 'Pendiente de subir'}
                      </small>
                    </div>
                    {attachment.status === 'ready' ? (
                      <button
                        className="icon-button"
                        aria-label={`Descargar ${attachment.filename}`}
                        onClick={() => {
                          setFileError(null)
                          void downloadAttachment(order.id, attachment).catch((error) =>
                            setFileError(error.message),
                          )
                        }}
                      >
                        <Download size={20} />
                      </button>
                    ) : (
                      <label className="button button-secondary file-button">
                        Volver a seleccionar
                        <input
                          type="file"
                          aria-label={`Volver a seleccionar ${attachment.filename}`}
                          onChange={(event) => {
                            void restore(attachment, event.target.files?.[0])
                            event.target.value = ''
                          }}
                        />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              {order.attachment_status === 'pending' && (
                <>
                  <p className="field-hint">
                    Si los archivos siguen en este dispositivo, reintenta la subida. Si cambiaste de
                    dispositivo, vuelve a seleccionar los originales. El pedido conserva su estado
                    pendiente hasta completar todos los archivos.
                  </p>
                  <button
                    className="button button-secondary"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    <RefreshCw size={16} />
                    {retry.isPending ? 'Subiendo…' : 'Reintentar archivos pendientes'}
                  </button>
                </>
              )}
              {(fileError || retry.error) && (
                <p className="field-error" role="alert">
                  {fileError || retry.error?.message}
                </p>
              )}
            </section>
            <aside className="panel order-summary">
              <p className="eyebrow">TOTAL DEL PEDIDO</p>
              <div className="summary-total">
                <strong>{money(order.total_amount)}</strong>
                <small>
                  {order.product_type === 'carrot'
                    ? `${quantity(order.hectares)} ha × ${money(order.unit_price)}`
                    : 'Suma de los importes por clasificación'}
                </small>
              </div>
              <dl className="payment-balances">
                <div>
                  <dt>Total pagado</dt>
                  <dd>{money(orderPaid(order))}</dd>
                </div>
                <div>
                  <dt>Restante</dt>
                  <dd>{money(orderRemaining(order))}</dd>
                </div>
              </dl>
              <Badge tone={order.payment_status === 'paid' ? 'green' : 'amber'}>
                {order.payment_status === 'paid'
                  ? 'Liquidado'
                  : order.payment_status === 'partial'
                    ? 'Pago parcial'
                    : 'Pendiente de pago'}
              </Badge>
              <div className="form-actions">
                <ActionLink
                  to={`/cobros/nuevo?customer_id=${order.customer_id}&order_id=${order.id}`}
                >
                  Registrar cobro
                </ActionLink>
                <Link className="subtle-link" to={`/cobros/clientes/${order.customer_id}`}>
                  Ver cuenta del cliente
                </Link>
              </div>
              <p className="field-hint">
                {localWorkspace
                  ? 'Calculado y guardado en este navegador.'
                  : 'Calculado y verificado en el servidor.'}
              </p>
              {order.product_type === 'potato' && (
                <dl className="potato-summary">
                  <div>
                    <dt>CANTIDAD TOTAL</dt>
                    <dd>{quantity(order.potato.total_quantity)}</dd>
                  </div>
                  <div>
                    <dt>PESO NETO TOTAL</dt>
                    <dd>{quantity(order.potato.net_total_weight)}</dd>
                  </div>
                </dl>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  )
}

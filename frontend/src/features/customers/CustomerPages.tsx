import { useState } from 'react'
import { groupNumber } from '../../lib/number-format'
import { Search, UsersRound, Plus, ArrowLeft, UserRound } from 'lucide-react'
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom'
import { useUnsavedCapture } from '../../lib/useUnsavedCapture'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ActionLink, Badge, EmptyState, PageHeader } from '../../components/ui'
import { QueryState } from '../../components/QueryState'
import { DeleteRecordButton } from '../../components/DeleteRecordButton'
import { useBase } from '../../app/useBase'
import { useAuth } from '../auth/AuthProvider'
import { request, type Customer, type Page } from '../../lib/business-api'
import { localWorkspace } from '../../lib/env'

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Introduce el nombre del cliente.')
    .max(200, 'Usa hasta 200 caracteres.'),
  notes: z.string().max(2000, 'Usa hasta 2,000 caracteres.'),
  active: z.boolean(),
})
type Values = z.infer<typeof schema>

export function CustomersPage() {
  const location = useLocation()
  const base = useBase(),
    preview = Boolean(base)
  const { principal } = useAuth()
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0)
  const [deleted, setDeleted] = useState(false)
  const query = useQuery({
    queryKey: ['customers', principal?.organization_id, search, offset],
    queryFn: () =>
      request<Page<Customer>>(`/customers?q=${encodeURIComponent(search)}&offset=${offset}`),
    enabled: !preview,
  })
  return (
    <>
      <PageHeader
        eyebrow="RELACIONES QUE CRECEN"
        title="Tus clientes"
        description="Un directorio claro para estar más cerca de cada cliente."
        action={
          <ActionLink to={`${base}/clientes/nuevo`}>
            <Plus size={17} />
            Nuevo cliente
          </ActionLink>
        }
      />
      {location.state?.saved && (
        <div className="notice" role="status">
          <p>Cliente guardado correctamente.</p>
        </div>
      )}
      {deleted && (
        <div className="notice" role="status">
          <p>Cliente eliminado.</p>
        </div>
      )}
      <section className="panel list-panel">
        <div className="list-toolbar">
          <h2>Directorio de clientes</h2>
          <label className="search-box">
            <Search size={18} />
            <input
              type="search"
              aria-label="Buscar clientes"
              placeholder="Buscar por nombre"
              value={search}
              disabled={preview}
              onChange={(event) => {
                setSearch(event.target.value)
                setOffset(0)
              }}
            />
          </label>
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
            icon={UsersRound}
            title={search ? 'No encontramos coincidencias' : 'Aquí comienzan tus relaciones'}
            description={
              preview
                ? 'Con una sesión autorizada podrás registrar, buscar y consultar los clientes de tu empresa.'
                : 'Da de alta un cliente para comenzar a registrar pedidos de zanahoria.'
            }
            action={
              <ActionLink secondary to={`${base}/clientes/nuevo`}>
                Nuevo cliente
              </ActionLink>
            }
          />
        )}
        {query.data && (
          <>
            <div className="record-list">
              {query.data.items.map((customer) => (
                <article className="record-row" key={customer.id}>
                  <span className="card-icon">
                    <UserRound size={21} />
                  </span>
                  <div className="record-copy">
                    <h3>{customer.name}</h3>
                    {customer.notes && <p>{customer.notes}</p>}
                  </div>
                  <Badge tone={customer.active ? 'green' : 'neutral'}>
                    {customer.active ? 'Activo' : 'Inactivo'}
                  </Badge>
                  {principal?.role === 'administrator' && (
                    <div className="record-actions">
                      <Link
                        className="button button-secondary"
                        to={`/clientes/${customer.id}/editar`}
                      >
                        Editar
                      </Link>
                      <DeleteRecordButton
                        kind="customer"
                        id={customer.id}
                        version={customer.version}
                        name={customer.name}
                        onDeleted={() => {
                          setDeleted(true)
                          setOffset(0)
                        }}
                      />
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="pagination">
              <span>{groupNumber(String(query.data.total))} clientes</span>
              <button
                className="button button-secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Anterior
              </button>
              <button
                className="button button-secondary"
                disabled={offset + 50 >= query.data.total}
                onClick={() => setOffset(offset + 50)}
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

export function CustomerFormPage({ editing = false }: { editing?: boolean }) {
  const base = useBase(),
    preview = Boolean(base),
    { id } = useParams(),
    navigate = useNavigate(),
    cache = useQueryClient()
  const { principal } = useAuth()
  const [recordId] = useState(() => crypto.randomUUID())
  const query = useQuery({
    queryKey: ['customer', principal?.organization_id, id],
    queryFn: () => request<Customer>(`/customers/${id}`),
    enabled: editing && !preview,
  })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', notes: '', active: true },
    values: query.data
      ? { name: query.data.name, notes: query.data.notes || '', active: query.data.active }
      : undefined,
  })
  const save = useMutation({
    mutationFn: (values: Values) =>
      request<Customer>(editing ? `/customers/${id}` : '/customers', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...values,
          notes: values.notes || null,
          ...(editing ? { expected_version: query.data?.version } : { id: recordId }),
        }),
      }),
    onSuccess: async (customer) => {
      cache.setQueryData(['customer', principal?.organization_id, customer.id], customer)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['customers'] }),
        cache.invalidateQueries({ queryKey: ['customer-picker'] }),
        cache.invalidateQueries({ queryKey: ['orders'] }),
        cache.invalidateQueries({ queryKey: ['order'] }),
        cache.invalidateQueries({ queryKey: ['accounts'] }),
        cache.invalidateQueries({ queryKey: ['account-picker'] }),
        cache.invalidateQueries({ queryKey: ['payment'] }),
        cache.invalidateQueries({ queryKey: ['payments'] }),
      ])
      navigate('/clientes', { state: { saved: true } })
    },
  })
  const canEdit = !editing || principal?.role === 'administrator' || preview
  useUnsavedCapture(form.formState.isDirty)
  const locked = save.isPending || (editing && !preview && !query.data) || !canEdit
  return (
    <>
      <Link className="back-link" to={`${base}/clientes`}>
        <ArrowLeft size={16} />
        Volver a clientes
      </Link>
      <PageHeader
        eyebrow="DIRECTORIO DE CLIENTES"
        title={editing ? 'Editar cliente' : 'Un nuevo vínculo.'}
        description="Solo los datos necesarios para comenzar."
      />
      {preview && (
        <div className="notice">
          <p>Puedes explorar los campos. El guardado requiere una sesión autorizada.</p>
        </div>
      )}
      {!preview && editing && (
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        />
      )}
      {!canEdit && (
        <p role="alert" className="field-error">
          La edición de clientes está disponible para administradores.
        </p>
      )}
      <form
        className="panel form-panel"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          if (!preview && !locked) save.mutate(values)
        })}
      >
        <div className="panel-heading">
          <h2>
            <UserRound size={20} />
            Información del cliente
          </h2>
          <Badge>{localWorkspace ? 'Directorio local' : 'Directorio privado'}</Badge>
        </div>
        <fieldset disabled={locked}>
          <div className="field">
            <label htmlFor="customer-name">
              Nombre del cliente <span aria-hidden="true">*</span>
            </label>
            <input
              id="customer-name"
              autoComplete="off"
              placeholder="Nombre de la persona o empresa"
              aria-invalid={Boolean(form.formState.errors.name)}
              aria-describedby="name-error"
              {...form.register('name')}
            />
            <p id="name-error" className="field-error">
              {form.formState.errors.name?.message}
            </p>
          </div>
          <div className="field">
            <label htmlFor="customer-notes">
              Notas <span className="optional">Opcional</span>
            </label>
            <textarea
              id="customer-notes"
              rows={4}
              placeholder="Información útil para tu equipo"
              aria-describedby="notes-error"
              {...form.register('notes')}
            />
            <p id="notes-error" className="field-error">
              {form.formState.errors.notes?.message}
            </p>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" {...form.register('active')} />
            Cliente activo
          </label>
        </fieldset>
        {save.error && (
          <p className="field-error" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="form-actions">
          <Link className="button button-secondary" to={`${base}/clientes`}>
            Volver al directorio
          </Link>
          <button className="button button-primary" type="submit" disabled={preview || locked}>
            {save.isPending ? 'Guardando…' : 'Guardar cliente'}
          </button>
        </div>
      </form>
    </>
  )
}

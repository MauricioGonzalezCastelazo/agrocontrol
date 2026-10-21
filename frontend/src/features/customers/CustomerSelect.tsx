import { useEffect, useRef, useState, type RefCallback } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import type { Customer, Page } from '../../lib/business-api'
type Choice = Pick<Customer, 'id' | 'name'>

type Props = {
  id: string
  selected: Pick<Customer, 'id' | 'name'> | null
  search: string
  onSearch: (value: string) => void
  onSelect: (customer: Choice) => void
  onBlur: () => void
  fieldRef: RefCallback<HTMLButtonElement>
  results?: Page<Choice>
  loading: boolean
  error: unknown
  onRetry: () => void
  disabled: boolean
  invalid: boolean
}

export function CustomerSelect({
  id,
  selected,
  search,
  onSearch,
  onSelect,
  onBlur,
  fieldRef,
  results,
  loading,
  error,
  onRetry,
  disabled,
  invalid,
}: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const items = results?.items || []
  const dialogId = `${id}-popup`,
    listId = `${id}-options`
  const activeId = !loading && !error && items[active] ? `${listId}-${items[active].id}` : undefined

  function close(restoreFocus = true) {
    setOpen(false)
    setActive(-1)
    onSearch('')
    if (restoreFocus) trigger.current?.focus()
  }
  function choose(customer: Choice) {
    onSelect(customer)
    close()
  }
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <div
      ref={root}
      className="customer-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          close(false)
          onBlur()
        }
      }}
    >
      <button
        id={id}
        type="button"
        ref={(node) => {
          trigger.current = node
          fieldRef(node)
        }}
        className={`customer-select-trigger ${selected ? '' : 'is-placeholder'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-value customer-error`}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => {
          if (open) close()
          else {
            onSearch('')
            setActive(-1)
            setOpen(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            onSearch('')
            setActive(-1)
            setOpen(true)
          }
        }}
      >
        <span id={`${id}-value`}>{selected?.name || 'Selecciona un cliente'}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && !disabled && (
        <div
          id={dialogId}
          className="customer-select-popup"
          role="dialog"
          aria-label="Seleccionar cliente"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            }
          }}
        >
          <div className="customer-select-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={input}
              type="text"
              role="combobox"
              aria-label="Buscar cliente"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={activeId}
              autoComplete="off"
              placeholder="Buscar por nombre…"
              value={search}
              onChange={(event) => {
                setActive(-1)
                onSearch(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (!loading && !error && items.length)
                    setActive((index) =>
                      event.key === 'ArrowDown'
                        ? (index + 1) % items.length
                        : index <= 0
                          ? items.length - 1
                          : index - 1,
                    )
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (!loading && !error && items.length) choose(items[active < 0 ? 0 : active])
                }
              }}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Clientes"
            aria-busy={loading}
            className="customer-select-options"
          >
            {!loading &&
              !error &&
              items.map((customer, index) => (
                <div
                  key={customer.id}
                  id={`${listId}-${customer.id}`}
                  role="option"
                  aria-selected={customer.id === selected?.id}
                  className={`customer-select-option ${index === active ? 'is-highlighted' : ''}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(customer)}
                >
                  <span>{customer.name}</span>
                  {customer.id === selected?.id && <Check size={17} aria-hidden="true" />}
                </div>
              ))}
          </div>
          {loading ? (
            <p className="customer-select-message" role="status">
              Buscando clientes…
            </p>
          ) : error ? (
            <div className="customer-select-message" role="alert">
              <p>No se pudieron cargar los clientes.</p>
              <button type="button" className="button button-secondary" onClick={onRetry}>
                Volver a intentar
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="customer-select-message" role="status">
              {search
                ? 'No encontramos clientes con ese nombre.'
                : 'Todavía no hay clientes activos.'}
            </p>
          ) : (
            results &&
            results.total > items.length && (
              <p className="customer-select-message">
                Escribe el nombre para encontrar más clientes.
              </p>
            )
          )}
        </div>
      )}
    </div>
  )
}

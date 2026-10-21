import type { UseFormReturn } from 'react-hook-form'
import { Controller, useWatch } from 'react-hook-form'
import { NumberInput } from '../../components/NumberInput'
import {
  previewPotato,
  potatoRules,
  type PotatoInput,
  type PotatoCalculation,
  type PotatoPreview,
} from './potato-domain'
import { money, quantity } from './domain'

function result(value: string | undefined) {
  return value === undefined ? 'Pendiente' : quantity(value)
}

export function PotatoFields({ form }: { form: UseFormReturn<PotatoInput> }) {
  const values = useWatch({ control: form.control }) as PotatoInput
  const calculated = previewPotato(values)
  return (
    <>
      <section className="potato-section" aria-labelledby="potato-grades-title">
        <div className="section-heading">
          <h3 id="potato-grades-title">Clasificación de papa</h3>
          <span className="field-hint">Calculado automáticamente</span>
        </div>
        <p className="field-hint">
          Captura solo las clasificaciones que se llevaron. Las demás cuentan como cero.
        </p>
        <div className="potato-grades">
          {potatoRules.grades.map((grade, index) => (
            <fieldset className="potato-grade" key={grade.code}>
              <legend>
                <strong>{grade.code}</strong>
                <span>{grade.description}</span>
              </legend>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor={`potato-quantity-${index}`}>Cantidad</label>
                  <Controller
                    name={`lines.${index}.quantity`}
                    control={form.control}
                    render={({ field }) => (
                      <NumberInput
                        id={`potato-quantity-${index}`}
                        aria-label={`Cantidad ${grade.code}`}
                        inputMode="decimal"
                        placeholder="0"
                        aria-invalid={Boolean(form.formState.errors.lines?.[index]?.quantity)}
                        aria-describedby={`quantity-error-${index}`}
                        {...field}
                      />
                    )}
                  />
                  <p id={`quantity-error-${index}`} className="field-error">
                    {form.formState.errors.lines?.[index]?.quantity?.message}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor={`potato-price-${index}`}>Precio unitario</label>
                  <Controller
                    name={`lines.${index}.unit_price`}
                    control={form.control}
                    render={({ field }) => (
                      <NumberInput
                        id={`potato-price-${index}`}
                        aria-label={`Precio unitario ${grade.code}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-invalid={Boolean(form.formState.errors.lines?.[index]?.unit_price)}
                        aria-describedby={`potato-price-error-${index}`}
                        {...field}
                      />
                    )}
                  />
                  <p id={`potato-price-error-${index}`} className="field-error">
                    {form.formState.errors.lines?.[index]?.unit_price?.message}
                  </p>
                </div>
              </div>
              <dl className="potato-calculated">
                <div>
                  <dt>Peso unitario neto</dt>
                  <dd>
                    <output aria-label={`Peso unitario neto ${grade.code}`}>
                      {result(calculated?.lines[index].allocated_unit_weight)}
                    </output>
                  </dd>
                </div>
                <div>
                  <dt>Peso neto</dt>
                  <dd>
                    <output aria-label={`Peso neto ${grade.code}`}>
                      {result(calculated?.lines[index].allocated_net_weight)}
                    </output>
                  </dd>
                </div>
                <div>
                  <dt>Importe</dt>
                  <dd>
                    <output aria-label={`Importe ${grade.code}`}>
                      {calculated.lines[index].line_total !== undefined
                        ? money(calculated.lines[index].line_total!)
                        : 'Pendiente'}
                    </output>
                  </dd>
                </div>
              </dl>
            </fieldset>
          ))}
        </div>
      </section>
      <section className="potato-section" aria-labelledby="truck-title">
        <div className="section-heading">
          <h3 id="truck-title">Pesaje del camión</h3>
        </div>
        <p className="field-hint">
          Captura los pesos en la misma unidad. El precio corresponde a esa unidad de peso. Las
          comas separan miles; usa punto para decimales.
        </p>
        <div className="form-grid truck-inputs">
          {(
            [
              ['gross_weight', 'BRUTO'],
              ['tare_weight', 'TARA'],
              ['additional_shrinkage', 'MERMA ADICIONAL'],
            ] as const
          ).map(([key, label]) => (
            <div className="field" key={key}>
              <label htmlFor={`potato-${key}`}>{label}</label>
              <Controller
                name={key}
                control={form.control}
                render={({ field }) => (
                  <NumberInput
                    id={`potato-${key}`}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-invalid={Boolean(form.formState.errors[key])}
                    aria-describedby={`${key}-error`}
                    {...field}
                  />
                )}
              />
              <p id={`${key}-error`} className="field-error">
                {form.formState.errors[key]?.message}
              </p>
            </div>
          ))}
          <div className="field">
            <label htmlFor="potato-shrinkage">MERMA</label>
            <Controller
              name="shrinkage_override"
              control={form.control}
              render={({ field }) => (
                <>
                  <NumberInput
                    {...field}
                    id="potato-shrinkage"
                    value={
                      field.value ??
                      (calculated.total_quantity === undefined
                        ? ''
                        : quantity(calculated.total_quantity).replace(/,/g, ''))
                    }
                    placeholder="Cantidad total"
                    aria-invalid={Boolean(form.formState.errors.shrinkage_override)}
                    aria-describedby="shrinkage-help shrinkage-error"
                  />
                  {field.value != null && (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => field.onChange(null)}
                    >
                      Usar cantidad total
                    </button>
                  )}
                </>
              )}
            />
            <p id="shrinkage-help" className="field-hint">
              Se llena con CANTIDAD TOTAL. Puedes borrar el número y escribir otro; tu valor se
              conserva aunque cambien las cantidades.
            </p>
            <p id="shrinkage-error" className="field-error">
              {form.formState.errors.shrinkage_override?.message}
            </p>
          </div>
        </div>
        <PotatoTotals calculated={calculated} />
        <p className="field-hint">
          PESO TOTAL = PESO − MERMA ADICIONAL − CANTIDAD TOTAL. Cambiar MERMA no modifica este
          cálculo.
        </p>
      </section>
    </>
  )
}

export function PotatoTotals({ calculated }: { calculated: PotatoPreview | null | undefined }) {
  return (
    <dl className="potato-calculated truck-results">
      {(
        [
          ['weight', 'PESO'],
          ['total_quantity', 'CANTIDAD TOTAL'],
          ['weight_after_shrinkage', 'PESO TOTAL'],
          ['net_unit_weight', 'PESO UNITARIO NETO'],
        ] as const
      ).map(([key, label]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <output aria-label={label}>{result(calculated?.[key])}</output>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function PotatoDetail({ data }: { data: PotatoCalculation }) {
  return (
    <div className="potato-section">
      {data.calculation_version !== potatoRules.version && (
        <p className="notice">
          Este pedido conserva su cálculo anterior. Al editar y guardar se descontarán CANTIDAD
          TOTAL y MERMA ADICIONAL.
        </p>
      )}
      <h3>Clasificación de papa</h3>
      <div className="potato-grades">
        {data.lines.map((line) => (
          <section key={line.grade_code} className="potato-grade">
            <h4>
              {line.grade_code}{' '}
              <small>
                {potatoRules.grades.find((grade) => grade.code === line.grade_code)?.description}
              </small>
            </h4>
            <dl className="potato-calculated">
              <div>
                <dt>Cantidad</dt>
                <dd>{quantity(line.quantity)}</dd>
              </div>
              <div>
                <dt>Precio unitario</dt>
                <dd>{money(line.unit_price)}</dd>
              </div>
              <div>
                <dt>Peso unitario neto</dt>
                <dd>{quantity(line.allocated_unit_weight)}</dd>
              </div>
              <div>
                <dt>Peso neto</dt>
                <dd>{quantity(line.allocated_net_weight)}</dd>
              </div>
              <div>
                <dt>Importe</dt>
                <dd>{money(line.line_total)}</dd>
              </div>
            </dl>
          </section>
        ))}
      </div>
      <h3>Pesaje del camión</h3>
      <dl className="potato-calculated truck-results">
        <div>
          <dt>BRUTO</dt>
          <dd>{quantity(data.gross_weight)}</dd>
        </div>
        <div>
          <dt>TARA</dt>
          <dd>{quantity(data.tare_weight)}</dd>
        </div>
        <div>
          <dt>MERMA ADICIONAL</dt>
          <dd>{quantity(data.additional_shrinkage)}</dd>
        </div>
        <div>
          <dt>MERMA</dt>
          <dd>{quantity(data.shrinkage ?? data.total_quantity)}</dd>
        </div>
      </dl>
      <PotatoTotals calculated={data} />
    </div>
  )
}

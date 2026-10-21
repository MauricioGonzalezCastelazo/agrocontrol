import { Carrot, Sprout } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { Controller } from 'react-hook-form'
import { NumberInput } from '../../components/NumberInput'
import type { CarrotValues } from './domain'

export type ProductFieldsProps = { form: UseFormReturn<CarrotValues>; disabled: boolean }
export function CarrotFields({ form, disabled }: ProductFieldsProps) {
  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor="unit-price">Precio unitario por hectárea</label>
        <Controller
          name="unit_price"
          control={form.control}
          render={({ field }) => (
            <NumberInput
              id="unit-price"
              inputMode="decimal"
              placeholder="0.00"
              disabled={disabled}
              aria-invalid={Boolean(form.formState.errors.unit_price)}
              aria-describedby="price-error"
              {...field}
            />
          )}
        />
        <p id="price-error" className="field-error">
          {form.formState.errors.unit_price?.message}
        </p>
      </div>
      <div className="field">
        <label htmlFor="hectares">Cantidad de hectáreas</label>
        <Controller
          name="hectares"
          control={form.control}
          render={({ field }) => (
            <NumberInput
              id="hectares"
              inputMode="decimal"
              placeholder="0.00"
              disabled={disabled}
              aria-invalid={Boolean(form.formState.errors.hectares)}
              aria-describedby="hectares-error"
              {...field}
            />
          )}
        />
        <p id="hectares-error" className="field-error">
          {form.formState.errors.hectares?.message}
        </p>
      </div>
      <p className="field-hint full-width">
        Importes en pesos mexicanos (MXN). Las comas separan miles automáticamente; usa punto para
        los decimales, hasta cuatro.
      </p>
    </div>
  )
}
type ProductDefinition = {
  label: string
  enabled: boolean
  icon: typeof Carrot
}
export const products = {
  carrot: { label: 'Zanahoria', enabled: true, icon: Carrot },
  potato: { label: 'Papa', enabled: true, icon: Sprout },
} satisfies Record<string, ProductDefinition>
export type ProductType = keyof typeof products

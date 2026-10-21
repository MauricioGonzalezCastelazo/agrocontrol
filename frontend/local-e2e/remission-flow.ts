import { expect, type Page } from '@playwright/test'
import { go, seedPayments } from './payment-flow'

export async function exerciseRemissionReuse(page: Page, product: 'carrot' | 'potato') {
  const { customer, carrot, potato } = await seedPayments(page)
  const original = product === 'carrot' ? carrot : potato
  await go(page, `/pedidos/${original.id}`)
  await page.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  await page
    .getByRole('dialog', { name: '¿Eliminar este pedido?', exact: true })
    .getByRole('button', { name: 'Eliminar pedido', exact: true })
    .click()
  await expect(page).toHaveURL(/\/pedidos$/)
  await go(page, '/pedidos/nuevo')
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill(customer.name)
  await page.getByRole('option', { name: customer.name, exact: true }).click()
  await page.getByLabel('Producto', { exact: true }).selectOption(product)
  await page
    .getByLabel('Número de remisión', { exact: true })
    .fill(String(original.remission_number))
  if (product === 'carrot') {
    await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('150')
    await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('2')
  } else {
    await page.getByLabel('Cantidad 1RA', { exact: true }).fill('10')
    await page.getByLabel('Precio unitario 1RA', { exact: true }).fill('2')
    await page.getByLabel('BRUTO', { exact: true }).fill('1000')
    await page.getByLabel('TARA', { exact: true }).fill('100')
    await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('0')
  }
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos\/[a-f0-9-]{36}$/)
  const replacementId = new URL(page.url()).pathname.split('/').pop()!
  expect(replacementId).not.toBe(original.id)
  const data = await page.evaluate(
    async ({ original, replacementId }) => {
      const { request } = await import('/src/lib/business-api.ts')
      const replacement = await request(`/orders/${replacementId}`)
      let deletedStatus = 0
      try {
        await request(`/orders/${original.id}`)
      } catch (error) {
        deletedStatus = error.status
      }
      return { replacement, deletedStatus }
    },
    { original, replacementId },
  )
  expect(data.deletedStatus).toBe(410)
  expect(data.replacement.remission_number).toBe(original.remission_number)
  expect(data.replacement.total_paid).toBe('0.00000000')
  // A later edit keeps the reservation, then releases it when the number changes.
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page.getByLabel('Número de remisión', { exact: true })).toBeEnabled()
  await page
    .getByLabel('Número de remisión', { exact: true })
    .fill(String(original.remission_number + 1))
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/pedidos/${replacementId}$`))
  const statuses = await page.evaluate(
    async ({ customerId, remission, product }) => {
      const { request } = await import('/src/lib/business-api.ts')
      const input = {
        customer_id: customerId,
        product_type: product,
        remission_number: remission,
        order_date: '2026-10-20',
        description: null,
        attachments: [],
        details:
          product === 'carrot'
            ? { hectares: '1', unit_price: '100' }
            : {
                gross_weight: '1000',
                tare_weight: '100',
                additional_shrinkage: '0',
                lines: ['1RA', '2DA', '3RA', '4TA'].map((grade_code, index) => ({
                  grade_code,
                  quantity: index === 0 ? '10' : '0',
                  unit_price: '2',
                })),
              },
      }
      const reused = await request('/orders', {
        method: 'POST',
        body: JSON.stringify({ ...input, id: crypto.randomUUID() }),
      })
      let duplicateStatus = 0
      try {
        await request('/orders', {
          method: 'POST',
          body: JSON.stringify({ ...input, id: crypto.randomUUID() }),
        })
      } catch (error) {
        duplicateStatus = error.status
      }
      return { reused, duplicateStatus }
    },
    { customerId: customer.id, remission: original.remission_number, product },
  )
  expect(statuses.reused.remission_number).toBe(original.remission_number)
  expect(statuses.duplicateStatus).toBe(409)
}

import { test, expect } from '@playwright/test'
import { seedPayments } from './payment-flow'
import { exerciseRemissionReuse } from './remission-flow'

for (const product of ['carrot', 'potato'] as const) {
  test(`reutilizar remisión eliminada de ${product}, editar y conservar unicidad`, async ({
    page,
  }) => {
    await page.goto('/')
    await exerciseRemissionReuse(page, product)
  })
}

test('remisión duplicada avisa y permite corregir sin perder el pedido', async ({ page }) => {
  await page.goto('/')
  const { customer, carrot } = await seedPayments(page)
  await page.goto('/pedidos/nuevo')
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill(customer.name)
  await page.getByRole('option', { name: customer.name, exact: true }).click()
  await page.getByLabel('Número de remisión', { exact: true }).fill(String(carrot.remission_number))
  await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('150')
  await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('2')
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByText(/Ya existe esa remisión en un pedido vigente/)).toBeVisible()
  await page.getByRole('button', { name: 'Comprobar y corregir captura', exact: true }).click()
  await expect(page.getByLabel('Número de remisión', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$300.00 MXN')
  await page
    .getByLabel('Número de remisión', { exact: true })
    .fill(String(carrot.remission_number + 1))
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos\/[a-f0-9-]{36}$/)
  await expect(
    page.locator('.summary-total').getByText('$300.00 MXN', { exact: true }),
  ).toBeVisible()
})

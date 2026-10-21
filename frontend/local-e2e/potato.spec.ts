import { test, expect } from '@playwright/test'
import { createPotatoCustomer, fillPotato, exercisePotato } from './potato-flow'

test('papa: clasificaciones, pesaje, edición, adjuntos y accesibilidad', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await exercisePotato(page)
  await page.reload()
  await expect(
    page.locator('.summary-total').getByText('$50,625.00 MXN', { exact: true }),
  ).toBeVisible()
})
test('papa local: crear y editar sin conexión conserva datos y cálculos', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000)
  await page.goto('/')
  const name = await createPotatoCustomer(page)
  await fillPotato(page)
  await page.getByLabel('MERMA', { exact: true }).fill('88.25')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page.getByLabel('MERMA', { exact: true })).toHaveValue('88.2500')
  await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+$/)
  await expect(
    page.locator('.summary-total').getByText('$51,750.00 MXN', { exact: true }),
  ).toBeVisible()
  await context.setOffline(false)
  await page.reload()
  await expect(
    page.locator('.summary-total').getByText('$51,750.00 MXN', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.truck-results').getByText('88.25', { exact: true })).toBeVisible()
})

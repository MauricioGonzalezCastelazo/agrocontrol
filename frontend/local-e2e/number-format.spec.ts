import { test, expect } from '@playwright/test'
import { createPotatoCustomer } from './potato-flow'

test('comas al escribir, pegar, borrar y editar sin alterar decimales guardados', async ({
  page,
}) => {
  await page.goto('/')
  const name = await createPotatoCustomer(page)
  await page.getByLabel('Producto', { exact: true }).selectOption('carrot')
  const hectares = page.getByLabel('Cantidad de hectáreas', { exact: true })
  const price = page.getByLabel('Precio unitario por hectárea', { exact: true })
  await hectares.pressSequentially('1234567.8900')
  await expect(hectares).toHaveValue('1,234,567.8900')
  await price.fill('2')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$2,469,135.78 MXN')

  await hectares.fill('1234.50')
  await hectares.press('Home')
  await hectares.press('ArrowRight')
  await hectares.pressSequentially('9')
  await expect(hectares).toHaveValue('19,234.50')
  await hectares.press('Backspace')
  await expect(hectares).toHaveValue('1,234.50')

  await hectares.fill('1234')
  await hectares.press('Home')
  await hectares.press('ArrowRight')
  await hectares.press('Delete')
  await expect(hectares).toHaveValue('134')
  await hectares.fill('12345')
  await hectares.press('Home')
  for (let count = 0; count < 3; count++) await hectares.press('ArrowRight')
  await hectares.press('Backspace')
  await expect(hectares).toHaveValue('1,345')

  await hectares.fill('2.0000')
  await price.fill('1,234.5000')
  await expect(price).toHaveValue('1,234.5000')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$2,469.00 MXN')
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').pop()!
  const saved = await page.evaluate(async (orderId) => {
    const { request } = await import('/src/lib/business-api.ts')
    return request<{ hectares: string; unit_price: string }>(`/orders/${orderId}`)
  }, id)
  expect(saved).toMatchObject({ hectares: '2.0000', unit_price: '1234.5000' })

  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(price).toHaveValue('1,234.5000')
  await page.getByLabel('Producto', { exact: true }).selectOption('potato')
  await page.getByLabel('Cantidad 1RA', { exact: true }).fill('1,234.5')
  await page.getByLabel('Precio unitario 1RA', { exact: true }).fill('2,000.2500')
  await page.getByLabel('BRUTO', { exact: true }).fill('20000.75')
  await page.getByLabel('TARA', { exact: true }).fill('1000.25')
  await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('100.5')
  await expect(page.getByLabel('BRUTO', { exact: true })).toHaveValue('20,000.75')
  await expect(page.getByLabel('TARA', { exact: true })).toHaveValue('1,000.25')
  await expect(page.getByLabel('MERMA', { exact: true })).toHaveValue('1,234.5')
  await expect(page.getByLabel('PESO TOTAL', { exact: true })).toHaveText('17,665.5')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$35,335,416.375 MXN')
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+$/)
  await expect(
    page.locator('.summary-total').getByText('$35,335,416.375 MXN', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.locator('.summary-total').getByText('$35,335,416.375 MXN', { exact: true }),
  ).toBeVisible()
})

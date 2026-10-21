import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { exerciseRecordLifecycle } from '../local-e2e/record-lifecycle'

async function login(page: Page) {
  const identity = await (await page.request.get('http://127.0.0.1:8101/__test__/identity')).json()
  await page.route('https://agrocontrol-browser-test.supabase.co/auth/v1/**', (route) =>
    route.fulfill({ status: 200, json: identity }),
  )
  await page.goto('/login')
  await page.getByLabel('Correo electrónico').fill('test@example.test')
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-test-password')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Todo listo para crecer.' })).toBeVisible()
}

test('edición y eliminación contra la API real, con clientes históricos y adjuntos', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await login(page)
  await exerciseRecordLifecycle(page, true)
})

async function customerAndOrder(page: Page, name: string) {
  await page.getByRole('link', { name: 'Clientes', exact: true }).click()
  await page.getByRole('link', { name: 'Nuevo cliente', exact: true }).first().click()
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page.getByText('Introduce el nombre del cliente.', { exact: true })).toBeVisible()
  await page.getByLabel('Nombre del cliente').fill(name)
  await page.getByLabel('Notas').fill('Datos sintéticos para pruebas')
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page).toHaveURL(/\/clientes$/)
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click()
  await page.getByRole('link', { name: 'Nuevo pedido', exact: true }).first().click()
  await page
    .locator('#remission-number')
    .fill(String(100000 + Math.floor(Math.random() * 2000000000)))
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill(name)
  await page.getByRole('option', { name, exact: true }).click()
  await page.getByLabel('Fecha del pedido', { exact: true }).fill('2026-03-12')
  await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('100.50')
  await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('1.25')
  await page.getByLabel('Descripción').fill('Pedido de zanahoria de prueba')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$125.625 MXN')
}

test('cliente, pedido, fecha y adjuntos reales con recuperación tras una subida interrumpida', async ({
  page,
}) => {
  await login(page)
  const name = `Cliente archivos ${crypto.randomUUID().slice(0, 8)}`
  await customerAndOrder(page, name)
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles([
    {
      name: 'nota.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 synthetic test'),
    },
    {
      name: 'documento.docx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetic Office document'),
    },
  ])
  await expect(page.getByText('nota.pdf', { exact: true })).toBeVisible()
  let fail = true
  await page.route('http://127.0.0.1:8101/api/v1/orders/*/attachments/*', async (route) => {
    if (route.request().method() === 'PUT' && fail) {
      fail = false
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]{36}$/)
  const path = new URL(page.url()).pathname
  await expect(page.getByText('Archivos pendientes', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  await login(page)
  await page.getByRole('link', { name: 'Pedidos', exact: true }).click()
  await page.locator('.order-row').filter({ hasText: name }).click()
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await page.getByRole('button', { name: 'Reintentar archivos pendientes' }).click()
  await expect(page.getByText('Guardado en servidor', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar nota.pdf' }).click()
  expect((await download).suggestedFilename()).toBe('nota.pdf')
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(audit.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('una respuesta perdida se recupera con el mismo pedido y sin duplicados', async ({ page }) => {
  await login(page)
  const name = `Cliente reintento ${crypto.randomUUID().slice(0, 8)}`
  await customerAndOrder(page, name)
  let fail = true
  await page.route('http://127.0.0.1:8101/api/v1/orders', async (route) => {
    if (route.request().method() === 'POST' && fail) {
      fail = false
      await route.fetch()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reintentar guardado' })).toBeVisible()
  await page.getByRole('button', { name: 'Reintentar guardado' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Volver a pedidos', exact: true }).click()
  await page.getByLabel('Buscar pedidos por cliente').fill(name)
  await expect(page.locator('.order-row')).toHaveCount(1)
})

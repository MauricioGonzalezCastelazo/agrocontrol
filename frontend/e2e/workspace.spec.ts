import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('sin sesión no se puede entrar al espacio privado', async ({ page }) => {
  await page.goto('/pedidos')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeDisabled()
  await expect(page.getByRole('link', { name: 'Explorar la base visual' })).toBeVisible()
})

test('recorrido de rutas, producto pendiente y navegación responsive', async ({
  page,
  isMobile,
}) => {
  await page.goto('/vista-previa')
  await expect(page.getByRole('heading', { name: 'Todo listo para crecer.' })).toBeVisible()
  const nav = page.getByRole('navigation', {
    name: isMobile ? 'Navegación móvil' : 'Navegación principal',
    exact: true,
  })
  await nav.getByRole('link', { name: 'Clientes', exact: true }).click()
  await page.getByRole('link', { name: 'Nuevo cliente', exact: true }).first().click()
  await expect(page.getByRole('button', { name: /Guardar cliente/ })).toBeDisabled()
  await nav.getByRole('link', { name: 'Pedidos', exact: true }).click()
  await page.getByRole('link', { name: 'Nuevo pedido', exact: true }).first().click()
  await page.getByLabel('Producto', { exact: true }).selectOption('potato')
  await expect(page.getByRole('heading', { name: 'Clasificación de papa' })).toBeVisible()
  await expect(page.getByLabel('Cantidad de hectáreas', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Guardar pedido/ })).toBeDisabled()
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((el) => el.clientWidth),
  )
})

for (const path of [
  '/login',
  '/vista-previa',
  '/vista-previa/clientes',
  '/vista-previa/pedidos/nuevo',
  '/vista-previa/sincronizacion',
  '/vista-previa/configuracion',
]) {
  test(`accesibilidad y ancho disponible: ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.getByRole('heading').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
}

test('las rutas de detalle y edición existen y el destino desconocido se recupera', async ({
  page,
}) => {
  await page.goto('/vista-previa/clientes/11111111-1111-4111-8111-111111111111/editar')
  await expect(page.getByRole('heading', { name: 'Editar cliente' })).toBeVisible()
  await page.goto('/vista-previa/pedidos/11111111-1111-4111-8111-111111111111')
  await expect(
    page.getByRole('heading', { name: 'Aún no hay un pedido para consultar' }),
  ).toBeVisible()
  await page.goto('/vista-previa/desconocido')
  await page.getByRole('link', { name: 'Volver al inicio' }).click()
  await expect(page.getByRole('heading', { name: 'Todo listo para crecer.' })).toBeVisible()
})

test('zanahoria tiene fecha editable, cálculo MXN y selección de adjuntos', async ({ page }) => {
  await page.goto('/vista-previa/pedidos/nuevo')
  await page.getByLabel('Fecha del pedido', { exact: true }).fill('2026-03-12')
  await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('100.50')
  await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('1.25')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$125.625 MXN')
  await page.getByLabel('Descripción').fill('Captura sintética')
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles([
    { name: 'nota.pdf', mimeType: 'application/pdf', buffer: Buffer.from('synthetic pdf') },
    {
      name: 'hoja.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetic spreadsheet'),
    },
  ])
  await expect(page.getByText('nota.pdf', { exact: true })).toBeVisible()
  await expect(page.getByText('hoja.xlsx', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Quitar nota.pdf' }).click()
  await expect(page.getByText('nota.pdf', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Guardar pedido', exact: true })).toBeDisabled()
})

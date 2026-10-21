import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export async function navigation(page: Page, label: string) {
  const mobile = await page.getByRole('navigation', { name: 'Navegación móvil' }).isVisible()
  await page
    .getByRole('navigation', { name: mobile ? 'Navegación móvil' : 'Navegación principal' })
    .getByRole('link', { name: label, exact: true })
    .click()
}
export async function createPotatoCustomer(page: Page) {
  const name = `Cliente papa ${crypto.randomUUID().slice(0, 8)}`
  await page.getByRole('heading').first().waitFor()
  await navigation(page, 'Clientes')
  await page.getByRole('link', { name: 'Nuevo cliente', exact: true }).first().click()
  await page.getByLabel('Nombre del cliente').fill(name)
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await navigation(page, 'Pedidos')
  await page.getByRole('link', { name: 'Nuevo pedido', exact: true }).first().click()
  await page
    .locator('#remission-number')
    .fill(String(100000 + Math.floor(Math.random() * 2000000000)))
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill(name)
  await page.getByRole('option', { name, exact: true }).click()
  await page.getByLabel('Producto', { exact: true }).selectOption('potato')
  return name
}
export async function fillPotato(page: Page) {
  await page.getByLabel('Fecha del pedido', { exact: true }).fill('2026-10-20')
  await page.getByLabel('BRUTO', { exact: true }).fill('12000')
  await page.getByLabel('TARA', { exact: true }).fill('2000')
  await expect(page.getByLabel('PESO', { exact: true })).toHaveText('10,000')
  await expect(page.getByLabel('PESO UNITARIO NETO', { exact: true })).toHaveText('Pendiente')
  await page.getByLabel('Cantidad 1RA', { exact: true }).fill('100')
  await page.getByLabel('Cantidad 3RA', { exact: true }).fill('700')
  await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('400')
  await expect(page.getByLabel('MERMA', { exact: true })).toHaveValue('800')
  await expect(page.getByLabel('PESO TOTAL', { exact: true })).toHaveText('8,800')
  await expect(page.getByLabel('PESO UNITARIO NETO', { exact: true })).toHaveText('11')
  await page.getByLabel('Precio unitario 1RA', { exact: true }).fill('10')
  await page.getByLabel('Precio unitario 3RA', { exact: true }).fill('5')
  await page.getByLabel(/^Descripción/).fill('Pedido de papa con clasificaciones mezcladas')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$49,500.00 MXN')
  await expect(page.getByLabel('Peso neto 1RA', { exact: true })).toHaveText('1,100')
  await expect(page.getByLabel('Peso neto 3RA', { exact: true })).toHaveText('7,700')
}
export async function exercisePotato(page: Page) {
  const name = await createPotatoCustomer(page)
  await fillPotato(page)
  const shrinkage = page.getByLabel('MERMA', { exact: true })
  await page.getByLabel('Cantidad 3RA', { exact: true }).fill('600')
  await expect(shrinkage).toHaveValue('700')
  await shrinkage.fill('')
  await expect(shrinkage).toHaveValue('')
  await page.getByLabel('Cantidad 3RA', { exact: true }).fill('700')
  await expect(shrinkage).toHaveValue('')
  await shrinkage.fill('50.25')
  await expect(page.getByLabel('PESO TOTAL', { exact: true })).toHaveText('8,800')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$49,500.00 MXN')
  await page.getByRole('button', { name: 'Usar cantidad total', exact: true }).click()
  await expect(shrinkage).toHaveValue('800')
  await shrinkage.fill('1,234.50')
  await page.getByLabel('Precio unitario 1RA', { exact: true }).fill('20')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$60,500.00 MXN')
  await page.getByLabel('Precio unitario 1RA', { exact: true }).fill('10')
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles({
    name: 'riesgo.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('blocked executable'),
  })
  await expect(page.getByText(/Formato no permitido/)).toBeVisible()
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles([
    {
      name: 'pesaje.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 synthetic weighing'),
    },
    {
      name: 'clasificaciones.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetic spreadsheet'),
    },
    {
      name: 'observaciones.docx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('synthetic word document'),
    },
  ])
  await expect(page.getByText('observaciones.docx', { exact: true })).toBeVisible()
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(audit.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar pesaje.pdf' })).toBeEnabled()
  await expect(
    page.locator('.summary-total').getByText('$49,500.00 MXN', { exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(shrinkage).toHaveValue('1,234.5000')
  await page.getByLabel('Cantidad 3RA', { exact: true }).fill('701')
  await expect(shrinkage).toHaveValue('1,234.5000')
  await page.getByLabel('Cantidad 3RA', { exact: true }).fill('700')
  await page.getByRole('button', { name: 'Usar cantidad total', exact: true }).click()
  await expect(shrinkage).toHaveValue('800')
  await expect(page.getByLabel('BRUTO', { exact: true })).toHaveValue('12,000.0000')
  await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('200')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$50,625.00 MXN')
  await page.getByLabel('Retirar pesaje.pdf', { exact: true }).check()
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles({
    name: 'nota.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('replacement note'),
  })
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Descargar nota.txt' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Descargar pesaje.pdf' })).toHaveCount(0)
  await expect(
    page.locator('.summary-total').getByText('$50,625.00 MXN', { exact: true }),
  ).toBeVisible()
  await navigation(page, 'Pedidos')
  await page.getByLabel('Filtrar por producto', { exact: true }).selectOption('potato')
  await page.locator('.order-row').filter({ hasText: name }).click()
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+$/)
  await expect(
    page.locator('.summary-total').getByText('$50,625.00 MXN', { exact: true }),
  ).toBeVisible()
  return name
}

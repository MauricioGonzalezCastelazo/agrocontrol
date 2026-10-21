import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export async function exerciseRecordLifecycle(page: Page, loseFirstUpdateResponse = false) {
  await page.getByRole('heading', { name: 'Todo listo para crecer.', exact: true }).waitFor()
  const name = `Cliente cambios ${crypto.randomUUID().slice(0, 8)}`
  const changedName = `${name} actualizado`
  async function navigate(label: string) {
    const mobile = await page.getByRole('navigation', { name: 'Navegación móvil' }).isVisible()
    await page
      .getByRole('navigation', { name: mobile ? 'Navegación móvil' : 'Navegación principal' })
      .getByRole('link', { name: label, exact: true })
      .click()
  }
  await navigate('Clientes')
  await page.getByRole('link', { name: 'Nuevo cliente', exact: true }).first().click()
  await page.getByLabel('Nombre del cliente').fill(name)
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await navigate('Pedidos')
  await page.getByRole('link', { name: 'Nuevo pedido', exact: true }).first().click()
  await page
    .locator('#remission-number')
    .fill(String(100000 + Math.floor(Math.random() * 2000000000)))
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill(name)
  await page.getByRole('option', { name, exact: true }).click()
  await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('100')
  await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('1')
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles({
    name: 'original.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('original document'),
  })
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar original.pdf' })).toBeEnabled()
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page.getByLabel('Precio unitario por hectárea', { exact: true })).toHaveValue(
    '100.0000',
  )
  await page.getByLabel('Fecha del pedido', { exact: true }).fill('2026-10-18')
  await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('200.20')
  await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('2.5')
  await page.getByLabel(/^Descripción/).fill('Pedido corregido con adjunto nuevo')
  await page.getByLabel('Retirar original.pdf', { exact: true }).check()
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles({
    name: 'corregido.docx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('corrected document'),
  })
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$500.50 MXN')
  let lost = false
  if (loseFirstUpdateResponse)
    await page.route('**/api/v1/orders/*', async (route) => {
      if (route.request().method() === 'PATCH' && !lost) {
        lost = true
        await route.fetch()
        await route.abort('failed')
      } else await route.continue()
    })
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  if (loseFirstUpdateResponse) {
    await expect(
      page.getByRole('button', { name: 'Reintentar guardado', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Reintentar guardado', exact: true }).click()
    expect(lost).toBe(true)
  }
  await expect(page.getByRole('button', { name: 'Descargar corregido.docx' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Descargar original.pdf' })).toHaveCount(0)
  await expect(
    page.locator('.summary-total').getByText('$500.50 MXN', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Pedido corregido con adjunto nuevo', { exact: true })).toBeVisible()
  await navigate('Clientes')
  const row = page
    .locator('.record-row')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
  await row.getByRole('link', { name: 'Editar', exact: true }).click()
  await page.getByLabel('Nombre del cliente').fill(changedName)
  await page.getByLabel(/^Notas/).fill('Cliente modificado desde el formulario')
  await page.getByLabel('Cliente activo', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page.getByRole('heading', { name: changedName, exact: true })).toBeVisible()
  await navigate('Pedidos')
  await page.locator('.order-row').filter({ hasText: changedName }).click()
  await expect(page.getByRole('heading', { name: changedName, exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page.getByLabel('Nombre del cliente', { exact: true })).toHaveText(changedName)
  await page.getByLabel(/^Descripción/).fill('Se conserva el cliente original inactivo')
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(
    page.getByText('Se conserva el cliente original inactivo', { exact: true }),
  ).toBeVisible()
  await navigate('Clientes')
  const changedRow = page
    .locator('.record-row')
    .filter({ has: page.getByRole('heading', { name: changedName, exact: true }) })
  await changedRow.getByRole('button', { name: 'Eliminar cliente', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '¿Eliminar este cliente?', exact: true })
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused()
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(audit.violations).toEqual([])
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(changedRow).toBeVisible()
  await changedRow.getByRole('button', { name: 'Eliminar cliente', exact: true }).click()
  await dialog.getByRole('button', { name: 'Eliminar cliente', exact: true }).click()
  await expect(changedRow).toHaveCount(0)
  await navigate('Pedidos')
  await page.locator('.order-row').filter({ hasText: changedName }).click()
  await expect(page.getByRole('heading', { name: changedName, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar corregido.docx' })).toBeEnabled()
  await page.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '¿Eliminar este pedido?', exact: true })
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('heading', { name: changedName, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  await dialog.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos$/)
  await expect(page.getByText('Pedido eliminado.', { exact: true })).toBeVisible()
  await expect(page.locator('.order-row').filter({ hasText: changedName })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}

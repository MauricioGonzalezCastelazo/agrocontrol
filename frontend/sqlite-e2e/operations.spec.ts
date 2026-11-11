import { test, expect } from './fixtures'
import { exercisePayments, exercisePaymentRemoval, seedPayments } from '../local-e2e/payment-flow'
import { exerciseRemissionReuse } from '../local-e2e/remission-flow'
import { createPotatoCustomer, fillPotato } from '../local-e2e/potato-flow'
import { go } from '../local-e2e/payment-flow'

test('SQLite: cobros, anticipos, aplicaciones y saldos exactos', async ({ page }) => {
  await exercisePayments(page, async () => {
    await page.reload()
    await expect(page.getByRole('heading').first()).toBeVisible()
  })
})

for (const mode of ['void', 'unassign'] as const)
  test(`SQLite: eliminar pedido después de ${mode}`, async ({ page }) => {
    await exercisePaymentRemoval(page, mode)
  })
for (const product of ['carrot', 'potato'] as const)
  test(`SQLite: remisiones de ${product}`, async ({ page }) => {
    await exerciseRemissionReuse(page, product)
  })

test('SQLite: papa, merma editable, adjuntos y recarga sin IndexedDB', async ({ page }) => {
  const name = await createPotatoCustomer(page)
  await fillPotato(page)
  await page.getByLabel('MERMA', { exact: true }).fill('1234.5678')
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles({
    name: 'pesaje.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 synthetic SQLite attachment'),
  })
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar pesaje.pdf' })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Descargar pesaje.pdf' })).toBeEnabled()
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page.getByLabel('MERMA', { exact: true })).toHaveValue('1,234.5678')
  await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('200')
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(
    page.locator('.summary-total').getByText('$50,625.00 MXN', { exact: true }),
  ).toBeVisible()
  const databases = await page.evaluate(() => indexedDB.databases())
  expect(databases.map((database) => database.name)).not.toContain('agrocontrol-local-workspace')
  expect(databases.map((database) => database.name)).not.toContain(
    'agrocontrol-pending-attachments',
  )
})

test('SQLite: una respuesta perdida no duplica el pedido', async ({ page }) => {
  const { customer } = await seedPayments(page)
  const result = await page.evaluate(async (customerId) => {
    const { request } = await import('/src/lib/business-api.ts')
    const payload = {
      id: crypto.randomUUID(),
      customer_id: customerId,
      product_type: 'carrot',
      remission_number: Math.floor(100000 + Math.random() * 2000000000),
      order_date: '2026-10-21',
      description: null,
      attachments: [],
      details: { hectares: '1.2345', unit_price: '99999999999999.9999' },
    }
    const first = await request('/orders', { method: 'POST', body: JSON.stringify(payload) })
    const second = await request('/orders', { method: 'POST', body: JSON.stringify(payload) })
    return { first, second }
  }, customer.id)
  expect(result.first.id).toBe(result.second.id)
  expect(result.second.unit_price).toBe('99999999999999.9999')
})

test('SQLite espera los saldos antes de guardar un cobro desde un pedido', async ({ page }) => {
  const { carrot } = await seedPayments(page)
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(
    (url) => url.pathname === '/api/v1/orders' && url.searchParams.has('customer_id'),
    async (route) => {
      await waiting
      await route.continue()
    },
  )
  try {
    await go(page, `/pedidos/${carrot.id}`)
    await page.getByRole('link', { name: 'Registrar cobro', exact: true }).click()
    await page.getByLabel('Monto recibido (MXN)').fill('1200')
    const save = page.getByRole('button', { name: 'Guardar cobro', exact: true })
    await expect(save).toBeDisabled()
    release()
    await expect(page.getByLabel('Monto aplicado 1 (MXN)')).toHaveValue('1,000.00000000')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page).toHaveURL(/\/cobros\/[a-f0-9-]{36}$/)
    await expect(
      page.locator('.finance-totals').getByText('$200.00 MXN', { exact: true }),
    ).toBeVisible()
  } finally {
    release()
  }
})

for (const point of ['before', 'after', 'unavailable'] as const)
  test(`SQLite recupera captura con adjunto interrumpido ${point}`, async ({ page }) => {
    const name = await createPotatoCustomer(page)
    await fillPotato(page)
    const file = {
      name: 'interrumpido.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 synthetic interrupted file'),
    }
    await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles(file)
    let interrupted = false
    let unavailable = point === 'unavailable'
    await page.route('**/api/v1/local/blobs/*', async (route) => {
      if (route.request().method() === 'GET' && unavailable) {
        unavailable = false
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'El archivo requiere revisión; conserva el original' }),
        })
      }
      if (route.request().method() !== 'PUT' || interrupted) return route.continue()
      interrupted = true
      if (point !== 'before') await route.fetch()
      await route.abort('failed')
    })
    await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('API local no está disponible')
    await go(page, '/sincronizacion')
    await page.getByRole('link', { name: 'Editar borrador', exact: true }).last().click()
    await expect(page.getByLabel('BRUTO', { exact: true })).toHaveValue('12,000')
    if (point !== 'after') {
      await expect(page.getByText(/estos documentos no terminaron de guardarse/)).toBeVisible()
      await page.getByLabel('Recuperar interrumpido.pdf', { exact: true }).setInputFiles(file)
    }
    await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Descargar interrumpido.pdf' })).toBeEnabled()
  })

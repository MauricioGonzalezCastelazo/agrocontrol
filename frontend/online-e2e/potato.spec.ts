import { test, expect, type Page } from '@playwright/test'
import {
  createPotatoCustomer,
  fillPotato,
  exercisePotato,
  navigation,
} from '../local-e2e/potato-flow'

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
  return identity
}
test('papa contra API real: cálculos, persistencia, archivos múltiples y edición', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await login(page)
  await exercisePotato(page)
})
test('papa: borrador editable offline, sincronización posterior y resolución explícita de conflicto', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000)
  const identity = await login(page)
  const name = await createPotatoCustomer(page)
  await fillPotato(page)
  await page.getByLabel('MERMA', { exact: true }).fill('125.5')
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles({
    name: 'sin-red.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 offline example'),
  })
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/sincronizacion$/)
  await page.getByRole('link', { name: 'Editar borrador', exact: true }).click()
  await expect(page.getByLabel('MERMA', { exact: true })).toHaveValue('125.5')
  await page.getByLabel('Precio unitario 1RA', { exact: true }).fill('20')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$60,500.00 MXN')
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/sincronizacion$/)
  await context.setOffline(false)
  await expect(page.getByRole('link', { name: 'Editar borrador', exact: true })).toHaveCount(0, {
    timeout: 15000,
  })
  await navigation(page, 'Pedidos')
  await page.locator('.order-row').filter({ hasText: name }).click()
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+$/)
  await expect(
    page.locator('.summary-total').getByText('$60,500.00 MXN', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar sin-red.pdf' })).toBeEnabled()
  const id = new URL(page.url()).pathname.split('/').pop()!
  const headers = {
    Authorization: `Bearer ${identity.access_token}`,
    'X-Organization-ID': '10000000-0000-4000-8000-000000000001',
  }
  const endpoint = `http://127.0.0.1:8101/api/v1/orders/${id}`
  const original = await (await page.request.get(endpoint, { headers })).json()
  await page.getByRole('link', { name: 'Editar pedido', exact: true }).click()
  await expect(page.getByLabel('MERMA', { exact: true })).toHaveValue('125.5000')
  await context.setOffline(true)
  await page.getByLabel('MERMA ADICIONAL', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
  await expect(page).toHaveURL(/\/sincronizacion$/)
  const changed = await page.request.patch(endpoint, {
    headers,
    data: {
      customer_id: original.customer_id,
      product_type: 'potato',
      order_date: original.order_date,
      description: 'Versión de otro dispositivo',
      expected_version: original.version,
      details: {
        gross_weight: original.potato.gross_weight,
        tare_weight: original.potato.tare_weight,
        additional_shrinkage: original.potato.additional_shrinkage,
        lines: original.potato.lines.map(
          (line: { grade_code: string; quantity: string; unit_price: string }) => ({
            grade_code: line.grade_code,
            quantity: line.quantity,
            unit_price: line.grade_code === '1RA' ? '30' : line.unit_price,
          }),
        ),
      },
      attachments: original.attachments.map(
        ({
          id,
          filename,
          size_bytes,
          sha256,
        }: {
          id: string
          filename: string
          size_bytes: number
          sha256: string
        }) => ({ id, filename, size_bytes, sha256 }),
      ),
    },
  })
  expect(changed.ok()).toBe(true)
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Comparar versiones', exact: true }).click()
  await expect(page.getByText('Versión de otro dispositivo', { exact: true })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Usar mis cambios', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Comparar versiones', exact: true })).toHaveCount(0)
  await navigation(page, 'Pedidos')
  await page.locator('.order-row').filter({ hasText: name }).click()
  await expect(page).toHaveURL(/\/pedidos\/[0-9a-f-]+$/)
  await expect(
    page.locator('.summary-total').getByText('$63,250.00 MXN', { exact: true }),
  ).toBeVisible()
  expect((await (await page.request.get(endpoint, { headers })).json()).total_amount).toBe(
    '63250.00000000',
  )
  expect(
    (await (await page.request.get(endpoint, { headers })).json()).potato.shrinkage_override,
  ).toBe('125.5000')
  await context.setOffline(true)
  const offline = await page.evaluate(async (orderId) => {
    const { request } = await import('/src/lib/business-api.ts')
    const { clearVerifiedScope } = await import('/src/lib/session-scope.ts')
    const cached = await request<{ total_amount: string }>(`/orders/${orderId}`)
    clearVerifiedScope()
    try {
      await request(`/orders/${orderId}`)
      return { total: cached.total_amount, status: 200 }
    } catch (error) {
      return { total: cached.total_amount, status: (error as { status: number }).status }
    }
  }, id)
  expect(offline).toEqual({ total: '63250.00000000', status: 401 })
})

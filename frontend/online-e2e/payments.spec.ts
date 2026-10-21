import { test, expect, type Page } from '@playwright/test'
import {
  exercisePayments,
  exercisePaymentRemoval,
  seedPayments,
  go,
} from '../local-e2e/payment-flow'
import { exerciseRemissionReuse } from '../local-e2e/remission-flow'

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

for (const product of ['carrot', 'potato'] as const) {
  test(`API: reutilizar remisión eliminada de ${product} y conservar unicidad`, async ({
    page,
  }) => {
    await login(page)
    await exerciseRemissionReuse(page, product)
  })
}
test('cobros contra API real: anticipo, reparto y saldos sin doble ingreso', async ({ page }) => {
  test.setTimeout(90_000)
  await login(page)
  await exercisePayments(page, () => login(page))
})
test('cobro guardado con respuesta perdida se recupera sin duplicarse', async ({ page }) => {
  await login(page)
  const { customer } = await seedPayments(page)
  await go(page, `/cobros/nuevo?customer_id=${customer.id}`)
  await page.getByRole('radio', { name: 'Anticipo / saldo a favor', exact: true }).check()
  await page.getByLabel('Monto recibido (MXN)').fill('1234.56789012')
  await page.getByLabel('Descripción del pago').fill('Cobro cuya respuesta se perdió')
  let dropped = false,
    postedId = ''
  await page.route('http://127.0.0.1:8101/api/v1/payments', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      const result = await route.fetch()
      expect(result.status()).toBe(201)
      postedId = (await result.json()).id
      dropped = true
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Guardar cobro', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reintentar guardado', exact: true })).toBeVisible()
  await go(page, '/sincronizacion')
  await expect(page.getByText(/Cobro cuya respuesta/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Revisar captura y reintentar', exact: true }).click()
  await expect(page.getByLabel('Monto recibido (MXN)')).toHaveValue('1,234.56789012')
  await expect(page.getByLabel('Monto recibido (MXN)')).toBeDisabled()
  await page.getByRole('button', { name: 'Reintentar guardado', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/cobros/${postedId}$`))
  const records = await page.evaluate(async (customerId) => {
    const { request } = await import('/src/lib/business-api.ts')
    return request(`/payments?customer_id=${customerId}`)
  }, customer.id)
  expect(records.total).toBe(1)
  expect(records.items[0].amount).toBe('1234.56789012')
  await go(page, '/sincronizacion')
  await expect(
    page.getByText('No hay cobros pendientes de confirmación.', { exact: true }),
  ).toBeVisible()
})

for (const mode of ['void', 'unassign'] as const) {
  test(`API: eliminar pedido tras ${mode === 'void' ? 'anular cobro' : 'quitar abono y conservar anticipo'}`, async ({
    page,
  }) => {
    await login(page)
    await exercisePaymentRemoval(page, mode)
  })
}

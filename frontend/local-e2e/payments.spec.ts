import { test, expect } from '@playwright/test'
import { exercisePayments, exercisePaymentRemoval, seedPayments } from './payment-flow'

test('cobros: abonos, anticipo, reparto, saldos por cliente y correcciones', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await exercisePayments(page)
})
test('cobros y anticipos locales se guardan también sin conexión', async ({ page, context }) => {
  await page.goto('/')
  const { customer, carrot } = await seedPayments(page)
  await page.goto(`/pedidos/${carrot.id}`)
  await page.getByRole('link', { name: 'Registrar cobro', exact: true }).click()
  await page.getByLabel('Monto recibido (MXN)').fill('1200')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Guardar cobro', exact: true }).click()
  await expect(page).toHaveURL(/\/cobros\/[a-f0-9-]{36}$/)
  await expect(
    page.locator('.finance-totals').getByText('$200.00 MXN', { exact: true }),
  ).toBeVisible()
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByRole('heading', { name: customer.name, exact: true })).toBeVisible()
  await expect(
    page.locator('.finance-totals').getByText('$200.00 MXN', { exact: true }),
  ).toBeVisible()
})

for (const mode of ['void', 'unassign'] as const) {
  test(`eliminar pedido tras ${mode === 'void' ? 'anular cobro' : 'quitar abono y conservar anticipo'}`, async ({
    page,
  }) => {
    await page.goto('/')
    await exercisePaymentRemoval(page, mode)
  })
}

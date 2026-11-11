import { test, expect } from './fixtures'
import { go, seedPayments } from '../local-e2e/payment-flow'

test('eliminar exige motivo y conserva valores anteriores y nuevos en auditoría', async ({
  page,
}) => {
  const { carrot } = await seedPayments(page)
  await go(page, `/pedidos/${carrot.id}`)
  await page.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const remove = dialog.getByRole('button', { name: 'Eliminar pedido', exact: true })
  await expect(remove).toBeDisabled()
  await dialog.getByLabel('Motivo de eliminación').fill('Captura duplicada: prueba sintética')
  const confirmation = page.waitForResponse((response) => response.request().method() === 'DELETE')
  await remove.click()
  const response = await confirmation
  expect(response.status()).toBe(200)
  const operation = response.headers()['x-operation-id']
  expect(operation).toBeTruthy()
  await expect(page).toHaveURL(/\/pedidos$/)
  const event = await page.evaluate(async (operationId) => {
    const { request } = await import('/src/lib/business-api.ts')
    return (await request(`/audit-events?operation_id=${operationId}`)).items[0]
  }, operation)
  expect(event.schema_version).toBe(2)
  expect(event.reason).toBe('Captura duplicada: prueba sintética')
  expect(event.occurred_at_utc).toMatch(/Z$/)
  expect(event.values_before.orders[carrot.id].deleted_at).toBeNull()
  expect(event.values_after.orders[carrot.id].deleted_at).toBeTruthy()
})

test('configuración revisa integridad y concilia documentos sin afirmar respaldo externo', async ({
  page,
}) => {
  await go(page, '/configuracion')
  await page.getByRole('button', { name: 'Revisar integridad', exact: true }).click()
  await expect(page.getByText(/Revisión terminada/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Conciliar documentos', exact: true }),
  ).toBeDisabled()
  await page.getByLabel('Motivo de conciliación').fill('Verificación sintética de documentos')
  await page.getByRole('button', { name: 'Conciliar documentos', exact: true }).click()
  await expect(page.getByText(/Operación confirmada:/)).toBeVisible()
  await expect(page.getByText(/El respaldo externo sigue pendiente/)).toBeVisible()
})

test('reintentar edición de cliente conserva el envío original aunque se actualice su consulta', async ({
  page,
}) => {
  const { customer } = await seedPayments(page)
  await go(page, `/clientes/${customer.id}/editar`)
  await page.getByLabel('Nombre del cliente').fill(`${customer.name} corregido`)
  await page.clock.install()
  let interrupted = false
  await page.route(`**/api/v1/customers/${customer.id}`, async (route) => {
    if (route.request().method() === 'PATCH' && !interrupted) {
      interrupted = true
      await route.fetch()
      return route.abort('failed')
    }
    return route.continue()
  })
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('resultado es incierto')
  await expect(page.getByLabel('Nombre del cliente')).toBeDisabled()
  await page.clock.fastForward(31_000)
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/customers/${customer.id}`) && response.request().method() === 'GET',
  )
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  expect((await (await refreshed).json()).version).toBe(2)
  const confirmation = page.waitForResponse((response) => response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Reintentar guardado', exact: true }).click()
  const response = await confirmation
  expect(response.request().postDataJSON().expected_version).toBe(1)
  expect(response.headers()['x-operation-replayed']).toBe('true')
  expect((await response.json()).version).toBe(2)
  await expect(page).toHaveURL(/\/clientes$/)
})

test('una edición con respuesta perdida se reintenta tras recargar sin cambiar de nuevo la versión', async ({
  page,
}) => {
  const { carrot } = await seedPayments(page)
  let interrupted = false
  await page.route(`**/api/v1/orders/${carrot.id}`, async (route) => {
    if (route.request().method() === 'PATCH' && !interrupted) {
      interrupted = true
      await route.fetch()
      return route.abort('failed')
    }
    return route.continue()
  })
  const result = await page.evaluate(async (order) => {
    const { request } = await import('/src/lib/business-api.ts')
    const key = crypto.randomUUID()
    const payload = {
      customer_id: order.customer_id,
      product_type: 'carrot',
      remission_number: order.remission_number,
      order_date: order.order_date,
      description: 'Edición durable sintética',
      details: { hectares: '2', unit_price: '1000' },
      attachments: [],
      expected_version: order.version,
    }
    let uncertain = false
    try {
      await request(`/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      uncertain = error instanceof Error && 'outcome' in error && error.outcome === 'uncertain'
    }
    const saved = await request(`/orders/${order.id}`)
    return { key, payload, version: saved.version, uncertain }
  }, carrot)
  expect(result.uncertain).toBe(true)
  await page.reload()
  const retried = await page.evaluate(
    async ({ orderId, original }) => {
      const { request } = await import('/src/lib/business-api.ts')
      return request(`/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Idempotency-Key': original.key },
        body: JSON.stringify(original.payload),
      })
    },
    { orderId: carrot.id, original: result },
  )
  expect(retried.version).toBe(result.version)
})

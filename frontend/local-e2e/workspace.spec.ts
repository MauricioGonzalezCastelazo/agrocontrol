import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'

test('cliente, zanahoria y adjuntos se guardan y sobreviven a recarga y cierre de pestaña', async ({
  page,
  context,
}) => {
  const privateCalls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/v1') || request.url().includes('.supabase.co/'))
      privateCalls.push(request.url())
  })
  await page.goto('/vista-previa/pedidos/nuevo')
  await expect(page).toHaveURL(/\/pedidos\/nuevo$/)
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await expect(page.getByText('Todavía no hay clientes activos.', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).press('Escape')
  await page.getByRole('link', { name: 'Dar de alta cliente' }).click()
  await expect(page.getByText('Modo local · Guardado habilitado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar cliente', exact: true })).toBeEnabled()
  await page.getByLabel('Nombre del cliente').fill('Cliente de prueba local')
  await page.getByLabel(/^Notas/).fill('Entrega en el rancho')
  await page.getByRole('button', { name: 'Guardar cliente', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cliente de prueba local' })).toBeVisible()
  const navigation = page.getByRole('navigation', {
    name: (await page.getByRole('navigation', { name: 'Navegación móvil' }).isVisible())
      ? 'Navegación móvil'
      : 'Navegación principal',
  })
  await navigation.getByRole('link', { name: 'Pedidos', exact: true }).click()
  await page.getByRole('link', { name: 'Nuevo pedido', exact: true }).first().click()
  await page
    .locator('#remission-number')
    .fill(String(100000 + Math.floor(Math.random() * 2000000000)))
  await expect(page.getByRole('combobox', { name: 'Buscar cliente', exact: true })).toHaveCount(0)
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  const customerSearch = page.getByRole('combobox', { name: 'Buscar cliente', exact: true })
  await expect(customerSearch).toBeFocused()
  await customerSearch.fill('Cliente de prueba')
  await expect(
    page.getByRole('option', { name: 'Cliente de prueba local', exact: true }),
  ).toBeVisible()
  const pickerAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(pickerAudit.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await customerSearch.press('ArrowDown')
  await customerSearch.press('Enter')
  await expect(page.getByLabel('Nombre del cliente', { exact: true })).toHaveText(
    'Cliente de prueba local',
  )
  await page.getByLabel('Nombre del cliente', { exact: true }).click()
  await customerSearch.fill('Cliente inexistente')
  await expect(
    page.getByText('No encontramos clientes con ese nombre.', { exact: true }),
  ).toBeVisible()
  await customerSearch.press('Escape')
  await expect(page.getByLabel('Nombre del cliente', { exact: true })).toBeFocused()
  await expect(page.getByLabel('Nombre del cliente', { exact: true })).toHaveText(
    'Cliente de prueba local',
  )
  await page.getByLabel('Fecha del pedido', { exact: true }).fill('2026-03-12')
  await page.getByLabel('Precio unitario por hectárea', { exact: true }).fill('100.50')
  await page.getByLabel('Cantidad de hectáreas', { exact: true }).fill('1.25')
  await expect(page.getByLabel('Precio total', { exact: true })).toHaveValue('$125.625 MXN')
  await page.getByLabel(/^Descripción/).fill('Zanahoria del lote norte')
  const pdf = Buffer.from('%PDF-1.7\nArchivo sintético de prueba local\n')
  const photo = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVioAAAAASUVORK5CYII=',
    'base64',
  )
  await page.getByLabel('Seleccionar archivos', { exact: true }).setInputFiles([
    { name: 'pedido.pdf', mimeType: 'application/pdf', buffer: pdf },
    { name: 'zanahoria.png', mimeType: 'image/png', buffer: photo },
  ])
  await expect(page.getByText('pedido.pdf', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Guardar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos\/[a-f0-9-]{36}$/)
  await expect(page.getByText('Pedido guardado en este navegador.', { exact: true })).toBeVisible()
  const orderUrl = page.url()
  await page.reload()
  await expect(page.getByText('Zanahoria del lote norte', { exact: true })).toBeVisible()
  await expect(
    page.locator('.summary-total').getByText('$125.625 MXN', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Descargar pedido.pdf' })).toBeEnabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar pedido.pdf' }).click()
  const downloaded = await download
  expect(downloaded.suggestedFilename()).toBe('pedido.pdf')
  expect(await readFile((await downloaded.path())!)).toEqual(pdf)
  expect(privateCalls).toEqual([])
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(orderUrl)
  await expect(
    reopened.getByRole('heading', { name: 'Cliente de prueba local', exact: true }),
  ).toBeVisible()
  await expect(reopened.getByRole('button', { name: 'Descargar zanahoria.png' })).toBeEnabled()
  const results = await new AxeBuilder({ page: reopened })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(results.violations).toEqual([])
  expect(
    await reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)
})

test('guardado local conserva precisión, evita duplicados y rechaza datos y archivos incorrectos', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { request } = await import('/src/lib/business-api.ts')
    async function rejected(action: () => Promise<unknown>) {
      try {
        await action()
        return false
      } catch {
        return true
      }
    }
    const customerId = crypto.randomUUID()
    const customer = { id: customerId, name: 'Prueba reglas local', notes: null, active: true }
    const customerPost = () =>
      request('/customers', { method: 'POST', body: JSON.stringify(customer) })
    await customerPost()
    await customerPost()
    const payload = {
      id: crypto.randomUUID(),
      customer_id: customerId,
      remission_number: 82,
      product_type: 'carrot',
      order_date: '2026-10-20',
      description: 'Prueba de precisión',
      details: { hectares: '9999999999.9999', unit_price: '99999999999999.9999' },
      attachments: [],
    }
    const post = (value = payload) =>
      request('/orders', { method: 'POST', body: JSON.stringify(value) })
    const order = await post()
    await post()
    const conflicting = await rejected(() => post({ ...payload, description: 'Otro pedido' }))
    const badDate = await rejected(() =>
      post({ ...payload, id: crypto.randomUUID(), order_date: '2026-02-30' }),
    )
    const edit = { name: 'Cliente actualizado', active: false, notes: null, expected_version: 1 }
    await request(`/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify(edit) })
    const staleEdit = await rejected(() =>
      request(`/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify(edit) }),
    )
    const inactive = await rejected(() => post({ ...payload, id: crypto.randomUUID() }))
    const renamed = await request(`/orders/${payload.id}`)
    const customers = await request('/customers')
    const orders = await request('/orders')
    // A pending attachment is never reported as ready until the original bytes match.
    const file = new Blob(['original'])
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const sha256 = Array.from(new Uint8Array(digest))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
    const newCustomer = { ...customer, id: crypto.randomUUID(), name: 'Cliente con archivos' }
    await request('/customers', { method: 'POST', body: JSON.stringify(newCustomer) })
    const attached = {
      ...payload,
      id: crypto.randomUUID(),
      customer_id: newCustomer.id,
      remission_number: 83,
      attachments: [
        { id: crypto.randomUUID(), filename: 'original.docx', size_bytes: file.size, sha256 },
      ],
    }
    await post(attached)
    const path = `/orders/${attached.id}/attachments/${attached.attachments[0].id}`
    const wrongHash = await rejected(() =>
      request(path, { method: 'PUT', body: new Blob(['modified']) }),
    )
    const pending = await request(`/orders/${attached.id}`)
    await request(path, { method: 'PUT', body: file })
    const ready = await request(`/orders/${attached.id}`)
    await request(path, { method: 'PUT', body: file })
    const repeated = await request(`/orders/${attached.id}`)
    return {
      order,
      conflicting,
      badDate,
      staleEdit,
      inactive,
      renamed,
      customers,
      orders,
      wrongHash,
      pending,
      ready,
      repeated,
    }
  })
  expect(result.customers.total).toBe(1)
  expect(result.orders.total).toBe(1)
  expect(result.order.total_amount).toBe('999999999999989999000000.00000001')
  expect(result.renamed.customer_name).toBe('Cliente actualizado')
  expect([
    result.conflicting,
    result.badDate,
    result.staleEdit,
    result.inactive,
    result.wrongHash,
  ]).toEqual([true, true, true, true, true])
  expect(result.pending.attachment_status).toBe('pending')
  expect(result.ready.attachment_status).toBe('complete')
  expect(result.ready.version).toBe(result.repeated.version)
})

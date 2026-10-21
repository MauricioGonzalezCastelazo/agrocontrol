import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Private sessions are intentionally in memory. Navigate within the SPA between views.
export async function go(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expect(page).toHaveURL(new URL(path, page.url()).href)
}

export async function seedPayments(page: Page) {
  return page.evaluate(async () => {
    const { request } = await import('/src/lib/business-api.ts')
    const customer = await request('/customers', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: `Cliente cobros ${crypto.randomUUID().slice(0, 8)}`,
        active: true,
        notes: null,
      }),
    })
    const remission = Math.floor(100000 + Math.random() * 2000000000)
    const base = {
      customer_id: customer.id,
      remission_number: remission,
      order_date: '2026-10-20',
      description: null,
      attachments: [],
    }
    const carrot = await request('/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...base,
        id: crypto.randomUUID(),
        product_type: 'carrot',
        details: { hectares: '1', unit_price: '1000' },
      }),
    })
    const potato = await request('/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...base,
        id: crypto.randomUUID(),
        product_type: 'potato',
        details: {
          gross_weight: '1000',
          tare_weight: '100',
          additional_shrinkage: '0',
          shrinkage_override: null,
          lines: ['1RA', '2DA', '3RA', '4TA'].map((grade_code, index) => ({
            grade_code,
            quantity: index === 0 ? '10' : '0',
            unit_price: '2',
          })),
        },
      }),
    })
    return { customer, carrot, potato }
  })
}
export async function auditFinance(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(result.violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
}
export async function exercisePayments(page: Page, loginAfterReload?: () => Promise<void>) {
  const { customer, carrot, potato } = await seedPayments(page)
  await go(page, `/pedidos/${carrot.id}`)
  await expect(
    page.locator('.payment-balances').getByText('$0.00 MXN', { exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Registrar cobro', exact: true }).click()
  await page.getByLabel('Monto recibido (MXN)').fill('300')
  await expect(page.getByLabel('Monto aplicado 1 (MXN)')).toHaveValue('300.00000000')
  await page.getByLabel('Fecha del pago').fill('2026-10-19')
  await page.getByLabel('Descripción del pago').fill('Primer abono por transferencia')
  await auditFinance(page)
  await page.getByRole('button', { name: 'Guardar cobro', exact: true }).click()
  await expect(page).toHaveURL(/\/cobros\/[a-f0-9-]{36}$/)
  await expect(
    page.getByText('Primer abono por transferencia', { exact: true }).first(),
  ).toBeVisible()
  await go(page, `/pedidos/${carrot.id}`)
  await expect(
    page.locator('.payment-balances').getByText('$300.00 MXN', { exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('.payment-balances').getByText('$700.00 MXN', { exact: true }),
  ).toBeVisible()
  // Capture an advance without selecting any order.
  await go(page, '/cobros/nuevo')
  await page.getByRole('radio', { name: 'Anticipo / saldo a favor', exact: true }).check()
  await page.getByLabel('Cliente', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Buscar cliente', exact: true }).fill(customer.name)
  await page.getByRole('option', { name: customer.name, exact: true }).click()
  await page.getByLabel('Monto recibido (MXN)').fill('2000')
  await expect(page.getByLabel('Monto recibido (MXN)')).toHaveValue('2,000')
  await page.getByLabel('Fecha del pago').fill('2026-10-20')
  await page.getByLabel('Descripción del pago').fill('Anticipo para próximas entregas')
  await page.getByRole('button', { name: 'Guardar cobro', exact: true }).click()
  await expect(page).toHaveURL(/\/cobros\/[a-f0-9-]{36}$/)
  const receiptUrl = page.url()
  await expect(
    page.locator('.finance-totals').getByText('$2,000.00 MXN', { exact: true }),
  ).toHaveCount(2)
  await page.getByRole('link', { name: 'Aplicar saldo a pedidos', exact: true }).click()
  await page.getByLabel('Producto 1', { exact: true }).selectOption('carrot')
  await page.getByLabel('Pedido 1', { exact: true }).selectOption(carrot.id)
  await expect(page.getByLabel('Remisión 1', { exact: true })).toHaveValue(
    String(carrot.remission_number),
  )
  await page.getByLabel('Monto aplicado 1 (MXN)').fill('700')
  await page.getByRole('button', { name: 'Agregar otro pedido', exact: true }).click()
  await page.getByLabel('Producto 2', { exact: true }).selectOption('potato')
  await page.getByLabel('Pedido 2', { exact: true }).selectOption(potato.id)
  await page.getByLabel('Monto aplicado 2 (MXN)').fill('500')
  await page.getByLabel('Descripción del pago').fill('Repartir anticipo en dos remisiones')
  await auditFinance(page)
  await page.getByRole('button', { name: 'Aplicar saldo a favor', exact: true }).click()
  await expect(page).toHaveURL(receiptUrl)
  await expect(
    page.locator('.finance-totals').getByText('$800.00 MXN', { exact: true }),
  ).toBeVisible()
  await go(page, `/cobros/clientes/${customer.id}`)
  const totals = page.locator('.finance-totals')
  await expect(totals.getByText('$2,300.00 MXN', { exact: true })).toBeVisible()
  await expect(totals.getByText('$1,500.00 MXN', { exact: true })).toBeVisible()
  await expect(totals.getByText('$800.00 MXN', { exact: true })).toBeVisible()
  await auditFinance(page)
  await go(page, `/pedidos/${carrot.id}`)
  await expect(page.getByText('Liquidado', { exact: true })).toBeVisible()
  await page.reload()
  if (loginAfterReload) {
    await loginAfterReload()
    await go(page, `/pedidos/${carrot.id}`)
  }
  await expect(
    page.locator('.payment-balances').getByText('$1,000.00 MXN', { exact: true }),
  ).toBeVisible()
  // Undo only the allocation, returning all of it to credit, without new income.
  await go(page, receiptUrl)
  await page.getByRole('button', { name: 'Quitar abono de estos pedidos', exact: true }).click()
  await page.getByLabel('Motivo del retiro').fill('Aplicación equivocada, conservar anticipo')
  await page.getByRole('button', { name: 'Confirmar retiro del abono', exact: true }).click()
  await expect(page.getByText('Abono retirado', { exact: true })).toBeVisible()
  await expect(
    page.locator('.finance-totals').getByText('$2,000.00 MXN', { exact: true }),
  ).toHaveCount(2)
  await page.getByRole('button', { name: 'Anular cobro', exact: true }).click()
  await page.getByLabel('Motivo de anulación').fill('Transferencia devuelta al cliente')
  await page.getByRole('button', { name: 'Confirmar anulación', exact: true }).click()
  await expect(page.getByText('Cobro anulado', { exact: true }).first()).toBeVisible()
  await go(page, `/pedidos/${carrot.id}`)
  await expect(
    page.locator('.payment-balances').getByText('$700.00 MXN', { exact: true }),
  ).toBeVisible()
  return { customer, carrot, potato }
}

export async function exercisePaymentRemoval(page: Page, mode: 'void' | 'unassign') {
  const { customer, carrot } = await seedPayments(page)
  const orderPath = `/pedidos/${carrot.id}`
  await go(page, orderPath)
  await page.getByRole('link', { name: 'Registrar cobro', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Abono a pedidos', exact: true })).toBeChecked()
  await page.getByLabel('Monto recibido (MXN)').fill('1200')
  await page.getByRole('button', { name: 'Guardar cobro', exact: true }).click()
  await expect(page).toHaveURL(/\/cobros\/[a-f0-9-]{36}$/)
  const paymentPath = new URL(page.url()).pathname
  await go(page, orderPath)
  await page.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '¿Eliminar este pedido?', exact: true })
  await expect(dialog.getByText(/tiene cobros vigentes/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Eliminar pedido', exact: true })).toHaveCount(0)
  await dialog.getByRole('link', { name: 'Ver cobros asociados', exact: true }).click()
  await expect(page.getByLabel('Filtrar cobros por pedido')).toHaveValue(carrot.id)
  await page.locator(`a.record-row[href="${paymentPath}"]`).click()
  if (mode === 'void') {
    await page.getByRole('button', { name: 'Anular cobro', exact: true }).click()
    await page.getByLabel('Motivo de anulación').fill('Cobro capturado por error')
    await page.getByRole('button', { name: 'Confirmar anulación', exact: true }).click()
    await expect(page.getByText('Cobro anulado', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Importe anulado', { exact: true })).toBeVisible()
  } else {
    await page.getByRole('button', { name: 'Quitar abono de estos pedidos', exact: true }).click()
    await page.getByLabel('Motivo del retiro').fill('Conservar el dinero para un pedido futuro')
    await page.getByRole('button', { name: 'Confirmar retiro del abono', exact: true }).click()
    await expect(page.getByText('Abono retirado', { exact: true })).toBeVisible()
    await expect(
      page.locator('.finance-totals').getByText('$1,200.00 MXN', { exact: true }),
    ).toHaveCount(2)
  }
  await go(page, orderPath)
  await expect(
    page.locator('.payment-balances').getByText('$0.00 MXN', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '¿Eliminar este pedido?', exact: true })
  await dialog.getByRole('button', { name: 'Eliminar pedido', exact: true }).click()
  await expect(page).toHaveURL(/\/pedidos$/)
  await expect(page.locator(`a.order-row[href="${orderPath}"]`)).toHaveCount(0)
  await go(page, paymentPath)
  await expect(page.getByText(/Pedido eliminado/)).toBeVisible()
  await expect(page.locator(`a[href="${orderPath}"]`)).toHaveCount(0)
  await auditFinance(page)
  await go(page, `/cobros/clientes/${customer.id}`)
  await page.getByRole('button', { name: mode === 'void' ? /^Anulados / : /^Vigentes / }).click()
  await expect(page.locator(`a.record-row[href="${paymentPath}"]`)).toBeVisible()
  const credit = mode === 'void' ? '$0.00 MXN' : '$1,200.00 MXN'
  await expect(
    page
      .locator('.finance-totals > div')
      .filter({ has: page.getByText('Saldo a favor disponible', { exact: true }) })
      .getByText(credit, { exact: true }),
  ).toBeVisible()
  await auditFinance(page)
}

import { test, expect } from '@playwright/test'

test('actualiza datos locales anteriores sin perder historial ni reservar remisiones eliminadas', async ({
  page,
}) => {
  // Serve an empty page before the app opens its database, in this test's isolated profile.
  await page.route('**/__legacy_workspace__', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Legacy fixture</title>',
    }),
  )
  await page.goto('/__legacy_workspace__')
  const ids = await page.evaluate(async () => {
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs')
    const db = new Dexie('agrocontrol-local-workspace')
    db.version(2).stores({
      customers: 'id',
      orders: 'id, &[record.product_type+record.remission_number]',
      files: 'id, orderId',
      payments: 'id, customer_id',
    })
    const now = '2026-10-20T12:00:00.000Z'
    const customerId = crypto.randomUUID()
    const deletedId = crypto.randomUUID()
    const activeId = crypto.randomUUID()
    const legacyId = crypto.randomUUID()
    const paymentId = crypto.randomUUID()
    const fileId = crypto.randomUUID()
    const record = {
      customer_id: customerId,
      customer_name: 'Cliente anterior',
      product_type: 'carrot',
      hectares: '1.0000',
      unit_price: '100.0000',
      total_amount: '100.00000000',
      order_date: '2026-10-20',
      currency: 'MXN',
      description: 'Conservar este registro',
      created_by: 'a1000000-0000-4000-8000-000000000001',
      created_at: now,
      updated_at: now,
      version: 1,
      attachments: [],
      attachment_status: 'complete',
    }
    await db.table('customers').add({
      id: customerId,
      fingerprint: 'legacy-customer',
      record: {
        id: customerId,
        name: record.customer_name,
        active: true,
        notes: null,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    })
    await db.table('orders').bulkAdd([
      {
        id: deletedId,
        fingerprint: 'legacy-deleted',
        deletedAt: now,
        record: { ...record, id: deletedId, remission_number: 1 },
      },
      {
        id: activeId,
        fingerprint: 'legacy-active',
        record: { ...record, id: activeId, remission_number: 2 },
      },
      { id: legacyId, fingerprint: 'legacy-no-remission', record: { ...record, id: legacyId } },
    ])
    await db.table('files').add({ id: fileId, orderId: deletedId, blob: new Blob(['legacy-file']) })
    await db.table('payments').add({
      id: paymentId,
      customer_id: customerId,
      fingerprint: 'legacy-payment',
      applicationHashes: {},
      record: {
        id: paymentId,
        customer_id: customerId,
        amount: '10.00000000',
        payment_date: record.order_date,
        description: 'Cobro anterior anulado',
        created_at: now,
        created_by: record.created_by,
        version: 2,
        voided_at: now,
        void_reason: 'Cancelado',
        applications: [
          {
            id: paymentId,
            application_date: record.order_date,
            description: null,
            voided_at: null,
            void_reason: null,
            allocations: [
              { order_id: deletedId, remission_number: 1, product_type: 'carrot', amount: '10' },
            ],
          },
        ],
      },
    })
    db.close()
    return { customerId, deletedId, activeId, legacyId, paymentId, fileId }
  })
  await page.goto('/pedidos')
  await expect(page.getByRole('heading', { name: 'Tus pedidos', exact: true })).toBeVisible()
  const result = await page.evaluate(async (ids) => {
    const { request } = await import('/src/lib/business-api.ts')
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs')
    const input = {
      customer_id: ids.customerId,
      product_type: 'carrot',
      remission_number: 1,
      order_date: '2026-10-20',
      description: null,
      attachments: [],
      details: { hectares: '1', unit_price: '100' },
    }
    const replacement = await request('/orders', {
      method: 'POST',
      body: JSON.stringify({ ...input, id: crypto.randomUUID() }),
    })
    let activeDuplicateStatus = 0
    try {
      await request('/orders', {
        method: 'POST',
        body: JSON.stringify({ ...input, id: crypto.randomUUID(), remission_number: 2 }),
      })
    } catch (error) {
      activeDuplicateStatus = error.status
    }
    const payment = await request(`/payments/${ids.paymentId}`)
    const legacy = await request(`/orders/${ids.legacyId}`)
    const db = new Dexie('agrocontrol-local-workspace')
    await db.open()
    const original = await db.table('orders').get(ids.deletedId)
    const file = await db.table('files').get(ids.fileId)
    const fileContents = await file.blob.text()
    const version = db.verno
    db.close()
    return { replacement, activeDuplicateStatus, payment, legacy, original, fileContents, version }
  }, ids)
  expect(result.version).toBe(3)
  expect(result.replacement.remission_number).toBe(1)
  expect(result.replacement.total_paid).toBe('0.00000000')
  expect(result.activeDuplicateStatus).toBe(409)
  expect(result.original.deletedAt).toBeTruthy()
  expect(result.original.record.remission_number).toBe(1)
  expect(result.original.fingerprint).toBe('legacy-deleted')
  expect(result.legacy.remission_number).toBeUndefined()
  expect(result.fileContents).toBe('legacy-file')
  expect(result.payment.applications[0].allocations[0]).toMatchObject({
    order_id: ids.deletedId,
    remission_number: 1,
    order_deleted: true,
  })
  expect(result.payment.available_credit).toBe('0.00000000')
  await page.reload()
  await expect(page.locator(`a.order-row[href="/pedidos/${result.replacement.id}"]`)).toBeVisible()
})

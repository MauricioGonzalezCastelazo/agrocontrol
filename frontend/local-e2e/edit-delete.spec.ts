import { test } from '@playwright/test'
import { exerciseRecordLifecycle } from './record-lifecycle'

test('edita y elimina clientes y pedidos conservando el historial y confirmando antes de eliminar', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await exerciseRecordLifecycle(page)
})

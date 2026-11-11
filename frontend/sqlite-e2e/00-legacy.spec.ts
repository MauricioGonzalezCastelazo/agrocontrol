import { test, expect } from './fixtures'

test('SQLite conserva IndexedDB anterior sin cambiar versiones, registros o documentos', async ({
  page,
}) => {
  const original = await page.evaluate(async () => {
    const { request } = await import('/src/lib/business-api.ts')
    const before = await request('/customers')
    const names = [
      'agrocontrol-local-workspace',
      'agrocontrol-pending-attachments',
      'agrocontrol-pending-payments',
      'agrocontrol-authorized-cache',
    ]
    for (const name of names) {
      await new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open(name, 2)
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore('historical', { keyPath: 'id' })
        }
        opening.onerror = () => reject(opening.error)
        opening.onsuccess = () => {
          const db = opening.result
          const transaction = db.transaction('historical', 'readwrite')
          transaction.objectStore('historical').put({
            id: 'historical-record',
            value: '123456789.12345678',
            original: new Blob(['historical-document-bytes']),
          })
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })
    }
    return { total: before.total, names }
  })
  await page.reload()
  await expect(page.getByText('Migración pendiente.', { exact: true })).toBeVisible()
  const result = await page.evaluate(async (names) => {
    const records = []
    for (const name of names)
      records.push(
        await new Promise((resolve, reject) => {
          const opening = indexedDB.open(name)
          opening.onerror = () => reject(opening.error)
          opening.onsuccess = () => {
            const db = opening.result
            const read = db
              .transaction('historical', 'readonly')
              .objectStore('historical')
              .get('historical-record')
            read.onsuccess = async () => {
              const bytes = await read.result.original.text()
              const version = db.version
              db.close()
              resolve({ version, value: read.result.value, bytes })
            }
          }
        }),
      )
    const { request } = await import('/src/lib/business-api.ts')
    return { records, total: (await request('/customers')).total }
  }, original.names)
  expect(result.total).toBe(original.total)
  expect(result.records).toEqual(
    original.names.map(() => ({
      version: 2,
      value: '123456789.12345678',
      bytes: 'historical-document-bytes',
    })),
  )
})

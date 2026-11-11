import { beforeEach, expect, test, vi } from 'vitest'

const { localRequest } = vi.hoisted(() => ({ localRequest: vi.fn() }))
vi.mock('../lib/local-api', () => ({ localRequest, localFetch: vi.fn() }))
import { SQLiteCaptures } from '../lib/sqlite-captures'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  let saved = { revision: 0, data: { files: [], drafts: [], payments: [] } }
  localRequest.mockReset()
  localRequest.mockImplementation(async (_path, options) => {
    if (options?.method === 'PUT') {
      const next = JSON.parse(options.body)
      expect(next.revision).toBe(saved.revision)
      saved = { ...next, revision: saved.revision + 1 }
    }
    return structuredClone(saved)
  })
})

test('concurrent captures wait for their own commit and reads see only committed data', async () => {
  const store = new SQLiteCaptures()
  const started = deferred()
  const release = deferred()
  const first = store.transaction('rw', async (transaction) => {
    await transaction.drafts.put({ key: 'first', scope: 'test' })
    started.resolve()
    await release.promise
    throw new Error('Interrupted capture')
  })
  const failed = expect(first).rejects.toThrow('Interrupted capture')
  await started.promise
  let confirmed = false
  const second = store.drafts.put({ key: 'second', scope: 'test' }).then(() => {
    confirmed = true
  })
  expect(await store.drafts.get('first')).toBeUndefined()
  expect(confirmed).toBe(false)
  release.resolve()
  await failed
  await second
  expect(confirmed).toBe(true)
  expect(await store.drafts.get('first')).toBeUndefined()
  expect(await store.drafts.get('second')).toEqual({ key: 'second', scope: 'test' })
})

test('a failed commit is never reported as saved and a later capture can succeed', async () => {
  const store = new SQLiteCaptures()
  const implementation = localRequest.getMockImplementation()!
  let fail = true
  localRequest.mockImplementation(async (...args) => {
    if (args[1]?.method === 'PUT' && fail) {
      fail = false
      throw new Error('Disk unavailable')
    }
    return implementation(...args)
  })
  await expect(store.drafts.put({ key: 'failed', scope: 'test' })).rejects.toThrow(
    'Disk unavailable',
  )
  await store.payments.put({ key: 'payment', scope: 'test' })
  expect(await store.drafts.get('failed')).toBeUndefined()
  expect(await store.payments.get('payment')).toEqual({ key: 'payment', scope: 'test' })
})

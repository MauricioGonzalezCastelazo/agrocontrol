import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('../lib/env', () => ({ env: { localApiUrl: 'http://127.0.0.1:8000/api/v1' } }))

beforeEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

function session() {
  return new Response(
    JSON.stringify({
      principal: {
        user_id: 'synthetic-user',
        organization_id: 'synthetic-org',
        role: 'administrator',
      },
      csrf: 'synthetic-csrf',
    }),
  )
}

test('a lost write response remains uncertain and never becomes a rejected save', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockRejectedValueOnce(new TypeError('Synthetic lost response')),
  )
  const { localRequest } = await import('../lib/local-api')
  await expect(localRequest('/customers', { method: 'POST', body: '{}' })).rejects.toMatchObject({
    outcome: 'uncertain',
    status: 0,
  })
})

test.each([409, 422, 503])(
  'HTTP %i distinguishes a known rejection from an uncertain result',
  async (status) => {
    const id = 'synthetic-operation-id'
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(session())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: 'Synthetic API result' }), {
            status,
            headers: { 'X-Operation-ID': id },
          }),
        ),
    )
    const { localRequest } = await import('../lib/local-api')
    await expect(localRequest('/orders', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      outcome: status < 500 ? 'rejected' : 'uncertain',
      status,
      operationId: id,
    })
  },
)

test('an incomplete success response does not confirm a save', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response('incomplete JSON', { status: 200 })),
  )
  const { localRequest } = await import('../lib/local-api')
  await expect(localRequest('/orders', { method: 'POST', body: '{}' })).rejects.toMatchObject({
    outcome: 'uncertain',
    status: 0,
  })
})

import { test as base, expect, type Page } from '@playwright/test'

export async function openSQLite(page: Page) {
  const response = await page.request.get('http://127.0.0.1:8102/__test__/launch', {
    headers: { 'X-Test-Harness': 'isolated-sqlite-browser-only' },
  })
  const { token } = await response.json()
  await page.goto(`/#agrocontrol-bootstrap=${token}`)
  await expect(page.getByRole('heading', { name: 'Todo listo para crecer.' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await openSQLite(page)
    await use(page)
  },
})
export { expect }

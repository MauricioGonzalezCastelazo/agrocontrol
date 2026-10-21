import { test, expect } from '@playwright/test'

test('el build compilado mantiene privadas las rutas sin vista previa ni modo local', async ({
  page,
}) => {
  for (const path of ['/vista-previa', '/clientes', '/pedidos/nuevo']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Todo empieza aquí.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Explorar la base visual' })).toHaveCount(0)
    await expect(page.getByText('Modo local · Guardado habilitado')).toHaveCount(0)
  }
})

test('el shell abre sin conexión y conserva el acceso privado', async ({ page, context }) => {
  await page.goto('/login')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true)
  const cachedPaths = await page.evaluate(async () => {
    const names = await caches.keys()
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((entry) => new URL(entry.url).pathname),
        ),
      )
    ).flat()
  })
  expect(cachedPaths).toContain('/index.html')
  expect(cachedPaths.filter((path) => path.startsWith('/assets/')).length).toBeGreaterThan(5)
  expect(
    cachedPaths.every(
      (path) => path === '/index.html' || path === '/favicon.svg' || path.startsWith('/assets/'),
    ),
  ).toBe(true)
  await context.setOffline(true)
  await page.goto('/pedidos/nuevo')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Todo empieza aquí.' })).toBeVisible()
})

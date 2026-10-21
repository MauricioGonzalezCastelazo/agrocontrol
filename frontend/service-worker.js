// Build-time placeholders. This worker stores only a public application shell.
const PRECACHE = __PRECACHE__
const CACHE = '__SHELL_VERSION__'
const allowed = new Set(PRECACHE)
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith('agrocontrol-shell-') && key !== CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  )
})
self.addEventListener('fetch', (event) => {
  const request = event.request,
    url = new URL(request.url)
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    request.headers.has('Authorization') ||
    url.pathname.startsWith('/api')
  )
    return
  if (request.mode === 'navigate') {
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match('/index.html')) || fetch(request)),
    )
  } else if (allowed.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) || fetch(request)),
    )
  }
})

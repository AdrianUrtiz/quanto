/* Quanto SW: shell instalable + páginas y estáticos cacheados para que la
   app bootee sin red y rehidrate desde IndexedDB (los datos viven en Dexie).
   Nunca se cachea /api/* (sesión y snapshot siempre van a la red). */
const CACHE = 'quanto-v3'
const CORE = [
  '/actividad',
  '/resumen',
  '/cuentas',
  '/ajustes',
  '/login',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // Uno por uno: si alguno falla (p. ej. instalar sin red),
      // los demás sí quedan guardados.
      await Promise.allSettled(
        CORE.map((url) => cache.add(url).catch(() => undefined)),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

function cacheable(res) {
  return !!res && res.ok && (res.type === 'basic' || res.type === 'default')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // API/auth/snapshot: siempre a la red, nunca a caché.
  if (url.pathname.startsWith('/api/')) return

  // Navegaciones (reload o URL directa): red primero con guardado;
  // sin red, la página cacheada y al final /actividad.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          if (cacheable(res)) {
            const cache = await caches.open(CACHE)
            cache.put(request, res.clone()).catch(() => undefined)
          }
          return res
        } catch {
          const hit = await caches.match(request).catch(() => undefined)
          if (hit) return hit
          const fallback = await caches
            .match('/actividad')
            .catch(() => undefined)
          if (fallback) return fallback
          throw new Error('offline sin copia cacheada')
        }
      })(),
    )
    return
  }

  // Estáticos versionados (_next/static): caché primero + revalidación.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const hit = await cache.match(request).catch(() => undefined)
        const update = fetch(request)
          .then((res) => {
            if (cacheable(res))
              cache.put(request, res.clone()).catch(() => undefined)
            return res
          })
          .catch(() => undefined)
        if (hit) {
          event.waitUntil(update)
          return hit
        }
        const res = await update
        if (res) return res
        throw new Error('offline sin copia cacheada')
      })(),
    )
    return
  }

  // Resto same-origin (chunks, imágenes, RSC): red primero con guardado,
  // caché como respaldo. Así una recarga offline puede bootear.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request)
        if (cacheable(res)) {
          const cache = await caches.open(CACHE)
          cache.put(request, res.clone()).catch(() => undefined)
        }
        return res
      } catch {
        const hit = await caches.match(request).catch(() => undefined)
        if (hit) return hit
        throw new Error('offline sin copia cacheada')
      }
    })(),
  )
})

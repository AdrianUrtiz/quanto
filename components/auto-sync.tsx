'use client'

import { useEffect } from 'react'

import { SNAPSHOT_VERSION, db } from '@/lib/offline/db'
import { SYNC_STALE_MS, getLastSyncAt, syncNow } from '@/lib/offline/sync'

// Sincroniza si la copia es vieja o de un snapshot anterior (evita pegarle
// a la central en cada render). Los errores son silenciosos: la app sigue
// con lo local.
async function syncIfStale() {
  if (!navigator.onLine) return
  const [last, meta] = await Promise.all([
    getLastSyncAt(),
    db.meta.get('sync').catch(() => undefined),
  ])
  // Copia de una versión anterior del snapshot: faltan tablas → re-descargar.
  if (meta && meta.snapshotVersion !== SNAPSHOT_VERSION) {
    try {
      await syncNow()
    } catch {
      // Best-effort.
    }
    return
  }
  if (last && Date.now() - new Date(last).getTime() < SYNC_STALE_MS) return
  try {
    await syncNow()
  } catch {
    // Best-effort: sin internet o fallo del servidor, se usan datos locales.
  }
}

/**
 * Auto-sync "siempre que se use la app": al montar, al volver la red,
 * al volver visible la pestaña y cada 15 min. Nunca bloquea la UI.
 */
export function AutoSync() {
  useEffect(() => {
    void syncIfStale()
    const id = window.setInterval(() => void syncIfStale(), SYNC_STALE_MS)
    const onOnline = () => void syncIfStale()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncIfStale()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}

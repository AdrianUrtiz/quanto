'use client'

import { useEffect } from 'react'

import { SYNC_STALE_MS } from '@/lib/offline/sync'
import { syncIfStale } from '@/lib/offline/useSnapshotSync'

/** Ventana corta al volver a la app (ver AutoSync). */
const FOCUS_STALE_MS = 60 * 1000

/**
 * Auto-sync "siempre que se use la app": al montar, al volver la red,
 * al volver visible la pestaña (o enfocar la ventana) y cada 15 min.
 * Al volver se usa ventana corta (60 s): la pareja pudo haber registrado
 * pagos o aceptado solicitudes hace segundos y los banners deben aparecer.
 * Nunca bloquea la UI.
 */
export function AutoSync() {
  useEffect(() => {
    void syncIfStale()
    const id = window.setInterval(() => void syncIfStale(), SYNC_STALE_MS)
    const onOnline = () => void syncIfStale()
    const onVisible = () => {
      if (document.visibilityState === 'visible')
        void syncIfStale(FOCUS_STALE_MS)
    }
    const onFocus = () => void syncIfStale(FOCUS_STALE_MS)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return null
}

'use client'

import { useEffect } from 'react'

import { SYNC_STALE_MS, pollLightUpdates } from '@/lib/offline/sync'
import { syncIfStale } from '@/lib/offline/useSnapshotSync'

/** Ventana corta al volver a la app (ver AutoSync). */
const FOCUS_STALE_MS = 60 * 1000
/** Poll de notificaciones con la app abierta (endpoint ligero). */
const POLL_MS = 30 * 1000

/**
 * Auto-sync "siempre que se use la app": al montar, al volver la red,
 * al volver visible la pestaña (o enfocar la ventana) y cada 15 min.
 * Al volver se usa ventana corta (60 s): la pareja pudo haber registrado
 * pagos o aceptado solicitudes hace segundos y los banners deben aparecer.
 * Además un poll ligero cada 30 s mantiene vivos los banners (pagos y
 * solicitudes) con la app abierta, sin descargar el snapshot completo.
 * Nunca bloquea la UI.
 */
export function AutoSync() {
  useEffect(() => {
    void syncIfStale()
    const id = window.setInterval(() => void syncIfStale(), SYNC_STALE_MS)
    const poll = window.setInterval(() => void pollLightUpdates(), POLL_MS)
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
      window.clearInterval(poll)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return null
}

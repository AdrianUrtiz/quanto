'use client'

import { useEffect } from 'react'

import { SYNC_STALE_MS } from '@/lib/offline/sync'
import { syncIfStale } from '@/lib/offline/useSnapshotSync'

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

'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { WifiOff } from 'lucide-react'

import { db } from '@/lib/offline/db'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'

/**
 * Icono flotante ámbar (superior derecha) cuando no hay conexión.
 * No bloquea ni deshabilita nada: FAB y formularios siguen visibles
 * (la creación offline llega en el próximo sprint).
 */
export function OfflineBadge() {
  const online = useOnlineStatus()
  const meta = useLiveQuery(() => db.meta.get('sync'), [])

  if (online) return null

  const last = meta?.lastSyncAt
    ? new Date(meta.lastSyncAt).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'sin copia local'

  return (
    <div
      role="status"
      aria-label="Sin conexión"
      title={`Sin conexión · últimos datos: ${last}`}
      className="pt-safe fixed top-3 right-4 z-50 flex size-10 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-500 shadow-lg backdrop-blur">
      <WifiOff className="size-5" />
    </div>
  )
}

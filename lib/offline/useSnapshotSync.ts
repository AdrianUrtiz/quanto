// Sincronización del snapshot con deduplicación (Fase 1: Dexie-first).
//
// Fuente única para `AutoSync` y los `*Shell`: evita el doble `syncNow()`
// cuando varios componentes montan a la vez (p. ej. `Providers` + tab).
// La UI sigue leyendo Dexie vía `useLiveQuery`; este módulo solo decide
// cuándo revalidar en background.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { SNAPSHOT_VERSION, db } from '@/lib/offline/db'
import { drainOutbox, hasOrphanEchoes } from '@/lib/offline/outbox'
import { SYNC_STALE_MS, getLastSyncAt, syncNow } from '@/lib/offline/sync'

let inFlight: Promise<boolean> | null = null

/**
 * Revalida la copia local solo si está vieja o es de un snapshot anterior.
 * Deduplica llamadas concurrentes. Nunca lanza: devuelve `false` si no
 * sincronizó (offline, fresca o fallo best-effort).
 */
export async function syncIfStale(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  if (inFlight) {
    try {
      return await inFlight
    } catch {
      return false
    }
  }
  const run = (async () => {
    // Subir ANTES de descargar: la descarga hace `clear()` y borraría los
    // ecos; lo subido llega como filas reales, lo fallido se repone después.
    // Si se subió algo, la copia está rancia por definición → descargar
    // aunque no haya vencido SYNC_STALE_MS (si no, el eco quedaría huérfano
    // con badge para siempre). Lo mismo si hay ecos sin op (app cerrada
    // entre subida y descarga): la fila real ya está en la central.
    let uploaded = 0
    try {
      uploaded = (await drainOutbox()).uploaded
    } catch {
      // Best-effort: si la subida falla se intenta igual la descarga.
    }
    if (uploaded > 0) {
      await syncNow()
      return true
    }
    try {
      if (await hasOrphanEchoes()) {
        await syncNow()
        return true
      }
    } catch {
      // Best-effort.
    }
    const [last, meta] = await Promise.all([
      getLastSyncAt(),
      db.meta.get('sync').catch(() => undefined),
    ])
    // Copia de una versión anterior del snapshot: faltan tablas → re-descargar.
    if (meta && meta.snapshotVersion !== SNAPSHOT_VERSION) {
      await syncNow()
      return true
    }
    if (last && Date.now() - new Date(last).getTime() < SYNC_STALE_MS)
      return false
    await syncNow()
    return true
  })()
  inFlight = run
  try {
    return await run
  } catch {
    // Best-effort: sin internet o fallo del servidor, se usan datos locales.
    return false
  } finally {
    if (inFlight === run) inFlight = null
  }
}

/**
 * Dispara `syncIfStale` al montar y expone el estado para los shells
 * (línea sutil "Actualizando…" sin bloquear la UI Dexie-first).
 */
export function useSnapshotSync(opts?: { eager?: boolean }) {
  const [isRevalidating, setIsRevalidating] = useState(false)
  const meta = useLiveQuery(() => db.meta.get('sync'), [])
  const started = useRef(false)
  const eager = opts?.eager ?? true

  const sync = useCallback(async () => {
    setIsRevalidating(true)
    try {
      await syncIfStale()
    } finally {
      setIsRevalidating(false)
    }
  }, [])

  useEffect(() => {
    if (!eager || started.current) return
    started.current = true
    void sync()
  }, [eager, sync])

  return {
    isRevalidating,
    lastSyncAt: meta?.lastSyncAt ?? null,
    sync,
  }
}

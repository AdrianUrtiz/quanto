// Motor de sincronización offline (Etapa 1: descarga, solo lectura).
//
// La central es la fuente de verdad: cada sync reemplaza la copia local.
// Sin cola de subida en v1 (la tabla `outbox` queda reservada para el
// sprint de creación offline).
'use client'

import { SNAPSHOT_VERSION, clearLocalData, db } from '@/lib/offline/db'
import type { SnapshotPayload } from '@/lib/offline/snapshot'

export const SYNC_STALE_MS = 15 * 60 * 1000

export class OfflineError extends Error {
  code: 'OFFLINE' | 'UNAUTH' | 'SERVER'
  constructor(code: OfflineError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export async function getLastSyncAt(): Promise<string | null> {
  try {
    const meta = await db.meta.get('sync')
    return meta?.lastSyncAt ?? null
  } catch {
    return null
  }
}

async function fetchSnapshot(): Promise<SnapshotPayload> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new OfflineError('OFFLINE', 'Sin conexión a internet')
  }
  const res = await fetch('/api/snapshot', { cache: 'no-store' })
  if (res.status === 401) {
    throw new OfflineError('UNAUTH', 'Sesión vencida, entra de nuevo')
  }
  // Sin sesión el proxy redirige a /login (HTML): no es un snapshot válido.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
    throw new OfflineError(
      res.status === 401 ? 'UNAUTH' : 'SERVER',
      res.status === 401
        ? 'Sesión vencida, entra de nuevo'
        : 'No se pudo descargar tus datos',
    )
  }
  const snap = (await res.json()) as SnapshotPayload
  if (snap.v !== SNAPSHOT_VERSION) {
    throw new OfflineError(
      'SERVER',
      'Actualiza la app para sincronizar (versión nueva)',
    )
  }
  return snap
}

async function saveSnapshot(snap: SnapshotPayload): Promise<void> {
  const prev = await db.meta.get('sync').catch(() => undefined)
  // Otro usuario en este dispositivo: limpiar antes de guardar.
  if (prev && prev.userId !== snap.userId) await clearLocalData()
  await db.transaction(
    'rw',
    [
      db.meta,
      db.accounts,
      db.transactions,
      db.shares,
      db.debtPayments,
      db.lineSums,
      db.categories,
      db.subscriptions,
      db.charges,
      db.partnerDebts,
      db.cardPay,
      db.partnerShared,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.transactions.clear(),
        db.shares.clear(),
        db.debtPayments.clear(),
        db.lineSums.clear(),
        db.categories.clear(),
        db.subscriptions.clear(),
        db.charges.clear(),
        db.partnerDebts.clear(),
        db.cardPay.clear(),
        db.partnerShared.clear(),
      ])
      await Promise.all([
        db.accounts.bulkPut(snap.accounts),
        db.transactions.bulkPut(snap.transactions),
        db.shares.bulkPut(snap.shares),
        db.debtPayments.bulkPut([
          ...snap.debtPayments.toConfirm,
          ...snap.debtPayments.myPending,
          ...snap.debtPayments.toConfirmSource,
        ]),
        db.lineSums.bulkPut(snap.lineSums),
        db.categories.bulkPut(snap.catalog),
        db.subscriptions.bulkPut(snap.subscriptions),
        db.charges.bulkPut(snap.charges),
        db.partnerDebts.bulkPut(snap.partnerDebts),
        db.cardPay.bulkPut(snap.cardPayItems),
        db.partnerShared.bulkPut(snap.partnerShared),
      ])
      await db.meta.put({
        key: 'sync',
        userId: snap.userId,
        lastSyncAt: new Date().toISOString(),
        snapshotVersion: snap.v,
      })
    },
  )
}

/** Descarga la copia del usuario y reemplaza la local. */
export async function syncNow(): Promise<SnapshotPayload> {
  const snap = await fetchSnapshot()
  await saveSnapshot(snap)
  return snap
}

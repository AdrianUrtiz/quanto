// Cola de subida offline: crear movimientos sin conexión.
//
// Solo CREACIÓN desde `TransactionForm` (edición/borrado siguen online).
// Cada op guarda el payload con forma de servidor + campos desnormalizados
// para el eco local. El eco (`temp-<uuid>`) pinta igual que una fila real
// en los derives Dexie-first; solo el badge lo distingue (`isPendingId`).
//
// Orden estricto: subir (drain) ANTES de descargar, porque `saveSnapshot`
// hace `clear()` + `bulkPut` y borraría los ecos. Tras descargar,
// `restoreEchoes()` repone los ecos de las ops que sigan en cola.
// La idempotencia la garantiza `clientKey` en el servidor: reintentar es seguro.
'use client'

import { createTransaction } from '@/lib/actions'
import { debtorMonthlyAmount } from '@/lib/calculations'
import { fromCents, toCents } from '@/lib/money'
import {
  db,
  type OfflineShare,
  type OfflineTransaction,
} from '@/lib/offline/db'
import { isPendingId, newTempShareId, newTempTxId } from '@/lib/offline/pending'
import { parseWallInput } from '@/lib/walltime'

export const OUTBOX_KIND_CREATE_TX = 'createTransaction'

/** Payload con forma de servidor (`TxSchema`) + display para el eco. */
export type CreateTxPayload = {
  clientKey: string
  tempTxId: string
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER'
  amount: number
  concept: string
  category: string
  /** Wall input "YYYY-MM-DDTHH:mm:ss.mmm" como lo construye el form. */
  date: string
  accountId: string
  accountName: string
  accountType: string
  transferToAccountId?: string
  transferToAccountName?: string
  transferToAccountType?: string
  installments: number
  isShared: boolean
  /** % del DEUDOR (el form ya manda `100 - miPct`, igual que online). */
  sharePct: number
  shareAmount?: number | null
  debtorId?: string
  debtorName?: string
  creatorName: string
  createdById: string
}

export type EnqueueInput = Omit<
  CreateTxPayload,
  'clientKey' | 'tempTxId' | 'accountName' | 'accountType' | 'creatorName' | 'createdById'
> & {
  accountName?: string
  accountType?: string
}

/** Pareja (deudor de mis compartidos) resuelta desde datos ya descargados. */
export async function resolvePartner(): Promise<{
  id: string
  name: string
} | null> {
  const meta = await db.meta.get('sync').catch(() => undefined)
  const meId = meta?.userId
  if (!meId) return null
  const shares = await db.shares.toArray().catch(() => [])
  const other = shares.find((s) => s.debtorId && s.debtorId !== meId)
  if (other) return { id: other.debtorId, name: other.debtorName }
  const partnerShared = await db.partnerShared.toArray().catch(() => [])
  if (partnerShared.length > 0) {
    return {
      id: partnerShared[0].createdById,
      name: partnerShared[0].creatorName,
    }
  }
  return null
}

/** Espejo cliente de `TxSchema` + reglas de cuentas (todo validable con Dexie). */
export function validateOfflineCreate(
  p: EnqueueInput,
  ctx: {
    accounts: { id: string; type?: string; isHidden?: boolean }[]
    categoryCodes: Set<string>
  },
): string | null {
  if (!(p.amount > 0)) return 'Ingresa un monto mayor a 0'
  if (p.concept.trim().length < 2) return 'Agrega un concepto'
  if (!ctx.categoryCodes.has(p.category)) return 'Categoría no disponible sin conexión'
  const origin = ctx.accounts.find(
    (a) => a.id === p.accountId && a.isHidden !== true,
  )
  if (!origin) return 'La cuenta ya no está disponible'
  if (p.type === 'TRANSFER') {
    if (!p.transferToAccountId || p.transferToAccountId === p.accountId)
      return 'Elige una cuenta destino distinta'
    const dest = ctx.accounts.find(
      (a) => a.id === p.transferToAccountId && a.isHidden !== true,
    )
    if (!dest) return 'La cuenta destino ya no está disponible'
    if ((origin.type ?? 'DEBIT') === 'CREDIT')
      return 'El traspaso debe salir de una cuenta de débito'
  }
  const n = Math.max(1, Math.round(p.installments || 1))
  if (p.type === 'EXPENSE' && (n < 1 || n > 24))
    return 'Parcialidades inválidas (1–24)'
  if (p.isShared) {
    if (p.type !== 'EXPENSE') return 'Solo los gastos se comparten'
    if (!p.debtorId) return 'Sin datos de tu pareja: conéctate una vez'
    if (p.shareAmount != null && p.shareAmount > p.amount)
      return 'La aportación no puede ser mayor al total'
    if (!(p.sharePct >= 1 && p.sharePct <= 100))
      return 'Porcentaje inválido (1–100)'
  }
  const d = parseWallInput(p.date)
  if (Number.isNaN(d.getTime())) return 'Fecha inválida'
  return null
}

/** Ajuste optimista de saldos (misma semántica que el servidor por suma). */
async function adjustBalancesForEcho(p: CreateTxPayload): Promise<void> {
  const origin = await db.accounts.get(p.accountId).catch(() => undefined)
  if (origin) {
    const delta =
      p.type === 'EXPENSE'
        ? origin.type === 'CREDIT'
          ? p.amount
          : -p.amount
        : p.type === 'INCOME'
          ? origin.type === 'CREDIT'
            ? -p.amount
            : p.amount
          : origin.type === 'CREDIT'
            ? 0
            : -p.amount
    await db.accounts.update(p.accountId, {
      balance: fromCents(toCents(origin.balance) + toCents(delta)),
    })
  }
  if (p.type === 'TRANSFER' && p.transferToAccountId) {
    const dest = await db.accounts.get(p.transferToAccountId).catch(() => undefined)
    if (dest) {
      const delta = dest.type === 'CREDIT' ? -p.amount : p.amount
      await db.accounts.update(p.transferToAccountId, {
        balance: fromCents(toCents(dest.balance) + toCents(delta)),
      })
    }
  }
}

/** Revierte el ajuste optimista de un eco (reasignar/descartar). */
async function revertBalancesForEcho(p: CreateTxPayload): Promise<void> {
  const origin = await db.accounts.get(p.accountId).catch(() => undefined)
  if (origin) {
    const delta =
      p.type === 'EXPENSE'
        ? origin.type === 'CREDIT'
          ? p.amount
          : -p.amount
        : p.type === 'INCOME'
          ? origin.type === 'CREDIT'
            ? -p.amount
            : p.amount
          : origin.type === 'CREDIT'
            ? 0
            : -p.amount
    // Si la cuenta ya no existe en local se omite: el próximo snapshot
    // trae saldos del servidor de todos modos.
    await db.accounts.update(p.accountId, {
      balance: fromCents(toCents(origin.balance) - toCents(delta)),
    })
  }
  if (p.type === 'TRANSFER' && p.transferToAccountId) {
    const dest = await db.accounts.get(p.transferToAccountId).catch(() => undefined)
    if (dest) {
      const delta = dest.type === 'CREDIT' ? -p.amount : p.amount
      await db.accounts.update(p.transferToAccountId, {
        balance: fromCents(toCents(dest.balance) - toCents(delta)),
      })
    }
  }
}
/** Inserta el eco local (filas temp) + ajusta saldos. Idempotente por `put`. */
async function applyEcho(p: CreateTxPayload): Promise<void> {
  const now = new Date().toISOString()
  const tx: OfflineTransaction = {
    id: p.tempTxId,
    concept: p.concept,
    category: p.category,
    amount: p.amount,
    date: parseWallInput(p.date).toISOString(),
    type: p.type,
    accountId: p.accountId,
    accountName: p.accountName,
    accountType: p.accountType,
    transferToAccountId: p.transferToAccountId ?? null,
    transferToAccountName: p.transferToAccountName ?? null,
    transferToAccountType: p.transferToAccountType ?? null,
    creatorName: p.creatorName,
    createdById: p.createdById,
    installments:
      p.type === 'EXPENSE' ? Math.max(1, Math.round(p.installments)) : 1,
    isShared: p.type === 'EXPENSE' && p.isShared,
    statementKey: null,
    partnerShare: false,
    locked: false,
    updatedAt: now,
  }
  await db.transactions.put(tx)
  if (tx.isShared && p.debtorId) {
    // Misma matemática que `createTransaction` (actions.ts): sharePct y
    // monthlyAmount del deudor (fijo pactado o porcentaje).
    const n = Math.max(1, Math.round(p.installments))
    const sharePct =
      p.shareAmount != null
        ? (toCents(p.shareAmount) / toCents(p.amount)) * 100
        : p.sharePct
    const monthlyAmount =
      p.shareAmount != null
        ? fromCents(Math.round(toCents(p.shareAmount) / n))
        : debtorMonthlyAmount(p.amount, p.installments, p.sharePct)
    const share: OfflineShare = {
      id: newTempShareId(),
      transactionId: p.tempTxId,
      debtorId: p.debtorId,
      debtorName: p.debtorName ?? 'Mi pareja',
      sharePct,
      monthlyAmount,
      isFixedAmount: p.shareAmount != null,
    }
    await db.shares.put(share)
  }
  await adjustBalancesForEcho(p)
}

/**
 * Encola un movimiento offline: valida, escribe eco + op PENDING en una
 * sola transacción Dexie. Devuelve el id temporal para el toast/navegación.
 */
export async function enqueueOfflineCreate(
  input: EnqueueInput,
): Promise<{ tempTxId: string }> {
  const meta = await db.meta.get('sync')
  const meId = meta?.userId
  if (!meId) throw new Error('Sin copia local: conéctate una vez')
  const tempTxId = newTempTxId()
  const origin = await db.accounts.get(input.accountId).catch(() => undefined)
  // Nombre del dueño desde una cuenta propia (ownerId == yo).
  const myAccounts = await db.accounts.toArray().catch(() => [])
  const mine = myAccounts.find((a) => a.ownerId === meId)
  const payload: CreateTxPayload = {
    ...input,
    clientKey: tempTxId,
    tempTxId,
    accountName: input.accountName ?? origin?.name ?? '',
    accountType: input.accountType ?? origin?.type ?? 'DEBIT',
    creatorName: mine?.owner ?? 'Tú',
    createdById: meId,
  }
  await db.transaction(
    'rw',
    [db.transactions, db.shares, db.accounts, db.outbox],
    async () => {
      await applyEcho(payload)
      await db.outbox.add({
        kind: OUTBOX_KIND_CREATE_TX,
        payload: JSON.stringify(payload),
        createdAt: new Date().toISOString(),
        status: 'PENDING',
      })
    },
  )
  return { tempTxId }
}

function rebuildFormData(p: CreateTxPayload): FormData {
  const fd = new FormData()
  fd.set('type', p.type)
  fd.set('amount', String(p.amount))
  fd.set('concept', p.concept)
  fd.set('category', p.category)
  fd.set('date', p.date)
  fd.set('accountId', p.accountId)
  if (p.transferToAccountId)
    fd.set('transferToAccountId', p.transferToAccountId)
  fd.set('installments', String(p.installments))
  if (p.isShared) {
    fd.set('isShared', 'true')
    fd.set('sharePct', String(p.sharePct))
    if (p.shareAmount != null) fd.set('shareAmount', String(p.shareAmount))
    if (p.debtorId) fd.set('debtorId', p.debtorId)
  }
  fd.set('clientKey', p.clientKey)
  return fd
}

let draining = false

/**
 * Sube las ops PENDING en orden de creación. Idempotente por `clientKey`:
 * reintentar nunca duplica. FAILED = rechazo explícito del servidor (se
 * conserva payload + error para la tarjeta de acciones urgentes); error de
 * red → vuelve a PENDING y se frena el drenado.
 */
export async function drainOutbox(): Promise<{
  uploaded: number
  failed: number
}> {
  if (draining) return { uploaded: 0, failed: 0 }
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return { uploaded: 0, failed: 0 }
  draining = true
  let uploaded = 0
  let failed = 0
  try {
    const ops = await db.outbox
      .orderBy('createdAt')
      .filter((o) => o.status === 'PENDING')
      .toArray()
      .catch(() => [])
    for (const op of ops) {
      if (op.kind !== OUTBOX_KIND_CREATE_TX || op.localId == null) continue
      let payload: CreateTxPayload
      try {
        payload = JSON.parse(op.payload) as CreateTxPayload
      } catch {
        await db.outbox.delete(op.localId).catch(() => undefined)
        continue
      }
      await db.outbox
        .update(op.localId, { status: 'SENDING' })
        .catch(() => undefined)
      try {
        const res = await createTransaction(rebuildFormData(payload))
        if (res && 'error' in res && res.error) {
          failed += 1
          await db.outbox
            .update(op.localId, { status: 'FAILED', error: res.error })
            .catch(() => undefined)
        } else {
          uploaded += 1
          // El eco lo borra la descarga posterior (`clear()`); la op se
          // elimina ya para no re-subirla.
          await db.outbox.delete(op.localId).catch(() => undefined)
        }
      } catch {
        // Red caída a mitad de drenado: vuelve a PENDING y se frena.
        await db.outbox
          .update(op.localId, { status: 'PENDING' })
          .catch(() => undefined)
        break
      }
    }
    return { uploaded, failed }
  } finally {
    draining = false
  }
}

/** ¿Hay ecos sin op (subida confirmada pero fila real aún no descargada)? */
export async function hasOrphanEchoes(): Promise<boolean> {
  const [temps, ops] = await Promise.all([
    db.transactions
      .filter((t) => isPendingId(t.id))
      .toArray()
      .catch(() => []),
    db.outbox.toArray().catch(() => []),
  ])
  if (temps.length === 0) return false
  const liveKeys = new Set<string>()
  for (const op of ops) {
    try {
      const payload = JSON.parse(op.payload) as Partial<CreateTxPayload>
      if (payload.tempTxId) liveKeys.add(payload.tempTxId)
    } catch {
      // Op corrupta: se purga en restoreEchoes.
    }
  }
  return temps.some((t) => !liveKeys.has(t.id))
}

/**
 * Tras cada descarga (`saveSnapshot` hace `clear()`), repone los ecos de
 * las ops que sigan en cola (fallidas o aún no subidas) para que no
 * desaparezcan de la UI. Sin eco previo no duplica (misma llave `put`).
 * Además purga ecos huérfanos (op ya subida y borrada pero descarga
 * posterior): la copia fresca ya trae la fila real del servidor.
 */
export async function restoreEchoes(): Promise<void> {
  const ops = await db.outbox.toArray().catch(() => [])
  const liveKeys = new Set<string>()
  const validOps: { op: (typeof ops)[number]; payload: CreateTxPayload }[] = []
  for (const op of ops) {
    if (op.kind !== OUTBOX_KIND_CREATE_TX) continue
    try {
      const payload = JSON.parse(op.payload) as CreateTxPayload
      if (!isPendingId(payload.tempTxId)) continue
      liveKeys.add(payload.tempTxId)
      validOps.push({ op, payload })
    } catch {
      // Op corrupta: no se puede subir ni restaurar → se elimina.
      if (op.localId != null)
        await db.outbox.delete(op.localId).catch(() => undefined)
    }
  }
  // Purga huérfanos: ecos cuya op ya no existe (subida confirmada).
  const orphans = await db.transactions
    .filter((t) => isPendingId(t.id) && !liveKeys.has(t.id))
    .toArray()
    .catch(() => [])
  for (const orphan of orphans) {
    await db.transactions.delete(orphan.id).catch(() => undefined)
    const orphanShares = await db.shares
      .where('transactionId')
      .equals(orphan.id)
      .toArray()
      .catch(() => [])
    await db.shares
      .bulkDelete(orphanShares.map((s) => s.id))
      .catch(() => undefined)
  }
  for (const { payload } of validOps) {
    const exists = await db.transactions
      .get(payload.tempTxId)
      .catch(() => undefined)
    if (exists) continue
    await db.transaction(
      'rw',
      [db.transactions, db.shares, db.accounts],
      async () => {
        await applyEcho(payload)
      },
    ).catch(() => undefined)
  }
}

/** ¿Hay ops pendientes o fallidas? (badge del FAB / banners). */
export async function outboxCount(): Promise<{
  pending: number
  failed: number
}> {
  const ops = await db.outbox.toArray().catch(() => [])
  return {
    pending: ops.filter((o) => o.status === 'PENDING').length,
    failed: ops.filter((o) => o.status === 'FAILED').length,
  }
}

/** Reasigna cuenta(s) a una op FAILED y la devuelve a PENDING. */
export async function reassignFailedOp(
  localId: number,
  accounts: { accountId?: string; transferToAccountId?: string },
): Promise<void> {
  const op = await db.outbox.get(localId).catch(() => undefined)
  if (!op) return
  const payload = JSON.parse(op.payload) as CreateTxPayload
  if (accounts.accountId) {
    payload.accountId = accounts.accountId
    const acc = await db.accounts.get(accounts.accountId).catch(() => undefined)
    if (acc) {
      payload.accountName = acc.name
      payload.accountType = acc.type
    }
  }
  if (accounts.transferToAccountId) {
    payload.transferToAccountId = accounts.transferToAccountId
    const acc = await db.accounts
      .get(accounts.transferToAccountId)
      .catch(() => undefined)
    if (acc) {
      payload.transferToAccountName = acc.name
      payload.transferToAccountType = acc.type
    }
  }
  await db.transaction(
    'rw',
    [db.transactions, db.shares, db.accounts, db.outbox],
    async () => {
      // Revierte el efecto en saldos del eco anterior (si la cuenta sigue
      // en local; si fue eliminada, el próximo snapshot corrige).
      const oldPayload = JSON.parse(op.payload) as CreateTxPayload
      await revertBalancesForEcho(oldPayload).catch(() => undefined)
      // Quita el eco viejo…
      await db.transactions.delete(payload.tempTxId).catch(() => undefined)
      const oldShares = await db.shares
        .where('transactionId')
        .equals(payload.tempTxId)
        .toArray()
        .catch(() => [])
      await db.shares
        .bulkDelete(oldShares.map((s) => s.id))
        .catch(() => undefined)
      // …y regenera el eco con las cuentas nuevas.
      await applyEcho(payload)
      await db.outbox.update(localId, {
        status: 'PENDING',
        error: null,
        payload: JSON.stringify(payload),
      })
    },
  )
}

/** Descarta una op FAILED (borra op + eco). */
export async function discardFailedOp(localId: number): Promise<void> {
  const op = await db.outbox.get(localId).catch(() => undefined)
  if (!op) return
  try {
    const payload = JSON.parse(op.payload) as CreateTxPayload
    if (payload.tempTxId && isPendingId(payload.tempTxId)) {
      await db.transaction(
        'rw',
        [db.transactions, db.shares, db.accounts],
        async () => {
          await revertBalancesForEcho(payload).catch(() => undefined)
          await db.transactions.delete(payload.tempTxId).catch(() => undefined)
          const oldShares = await db.shares
            .where('transactionId')
            .equals(payload.tempTxId)
            .toArray()
            .catch(() => [])
          await db.shares
            .bulkDelete(oldShares.map((s) => s.id))
            .catch(() => undefined)
        },
      ).catch(() => undefined)
    }
  } catch {
    // Sin payload válido igual se borra la op.
  }
  await db.outbox.delete(localId).catch(() => undefined)
}

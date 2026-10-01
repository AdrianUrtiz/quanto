import type { Prisma } from '@prisma/client'

import { fromCents, toCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { wallNow } from '@/lib/walltime'

/** Cliente capaz de correr dentro o fuera de una transacción. */
export type TxDb = Prisma.TransactionClient

export type LineSums = { confirmed: number; pending: number }

/** Suma CONFIRMED/PENDING por línea (shareId + month "YYYY-MM"). */
export async function getLineSums(
  shareIds: string[],
  db: TxDb = prisma,
): Promise<Map<string, LineSums>> {
  const map = new Map<string, LineSums>()
  if (!shareIds.length) return map
  const rows = await db.debtPayment.findMany({
    where: {
      shareId: { in: shareIds },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: { shareId: true, month: true, amount: true, status: true },
  })
  const centsMap = new Map<string, { confirmed: number; pending: number }>()
  for (const r of rows) {
    const key = `${r.shareId}:${r.month}`
    const s = centsMap.get(key) ?? { confirmed: 0, pending: 0 }
    if (r.status === 'CONFIRMED') s.confirmed += toCents(r.amount)
    else s.pending += toCents(r.amount)
    centsMap.set(key, s)
  }
  for (const [k, s] of centsMap)
    map.set(k, { confirmed: fromCents(s.confirmed), pending: fromCents(s.pending) })
  return map
}

export function lineRemaining(monthly: number, sums?: LineSums): number {
  return fromCents(
    Math.max(0, toCents(monthly) - toCents(sums?.confirmed ?? 0)),
  )
}

export function lineKey(shareId: string, month: string): string {
  return `${shareId}:${month}`
}

/**
 * Sincroniza el check de suscripción con los pagos CONFIRMED de la línea.
 * Si el share pertenece a un cargo de suscripción, marca/desmarca
 * partnerPaid según lo cubierto (tolerancia de centavos). Sin dinero de por
 * medio aquí: solo refleja en Suscripciones lo liquidado en Pareja.
 */
export async function syncSubscriptionCheck(
  db: TxDb,
  shareId: string,
  month: string,
  actorId: string,
): Promise<void> {
  const share = await db.transactionShare.findUnique({
    where: { id: shareId },
    select: {
      monthlyAmount: true,
      transaction: { select: { subscriptionId: true } },
    },
  })
  const subId = share?.transaction.subscriptionId
  if (!share || !subId) return
  const rows = await db.debtPayment.findMany({
    where: { shareId, month, status: 'CONFIRMED' },
    select: { amount: true },
  })
  const confirmedC = rows.reduce((a, r) => a + toCents(r.amount), 0)
  const covered = confirmedC - toCents(share.monthlyAmount) >= 0
  const charge = await db.subscriptionCharge.findUnique({
    where: { subscriptionId_month: { subscriptionId: subId, month } },
    select: { id: true, partnerPaid: true },
  })
  if (!charge || charge.partnerPaid === covered) return
  await db.subscriptionCharge.update({
    where: { id: charge.id },
    data: covered
      ? {
          partnerPaid: true,
          partnerPaidById: actorId,
          partnerPaidAt: wallNow(),
        }
      : { partnerPaid: false, partnerPaidById: null, partnerPaidAt: null },
  })
}

/**
 * Crea el ingreso del acreedor (cobro de pareja).
 * El saldo se deriva por suma (lib/balances.ts): aquí solo se crea el
 * movimiento. Categoría fija TRANSFERENCIA. Corre dentro o fuera de transacción.
 * La validación de categoría y propiedad de la cuenta la hace el llamador.
 */
export async function createCreditorIncome(
  db: TxDb,
  opts: {
    amount: number
    concept: string
    accountId: string
    userId: string
  },
): Promise<string> {
  const tx = await db.transaction.create({
    data: {
      type: 'INCOME',
      amount: opts.amount,
      concept: opts.concept,
      category: 'TRANSFERENCIA',
      date: wallNow(),
      accountId: opts.accountId,
      createdById: opts.userId,
      installments: 1,
      isShared: false,
    },
  })
  return tx.id
}

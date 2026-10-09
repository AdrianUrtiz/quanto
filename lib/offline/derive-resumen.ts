// Derivación del view-model de Resumen desde filas Dexie (Etapa 3).
//
// Réplica en cliente la forma que `app/(app)/resumen/page.tsx` le pasa a
// `ResumenClient`. Puro y sin Prisma: opera sobre arrays.
import type { CreditStatementView } from '@/components/credit-statements'
import type {
  ResumenInvolvedTx,
  ResumenMineTx,
} from '@/components/resumen-client'

import type {
  OfflineAccount,
  OfflineLineSum,
  OfflinePartnerShared,
  OfflineShare,
  OfflineTransaction,
} from '@/lib/offline/db'
import { isPendingId } from '@/lib/offline/pending'
import { deriveMonths, toCatalog } from '@/lib/offline/derive-activity'
import { type StatementTx, activePeriods } from '@/lib/statements'
import { wallNow } from '@/lib/walltime'

export { deriveMonths, toCatalog }

/** MIS movimientos (donut): EXPENSE/INCOME propios, sin parte de pareja. */
export function toMineTxs(rows: OfflineTransaction[]): ResumenMineTx[] {
  return rows
    .filter(
      (t) => !t.partnerShare && (t.type === 'EXPENSE' || t.type === 'INCOME'),
    )
    .map((t) => ({
      id: t.id,
      type: t.type as 'EXPENSE' | 'INCOME',
      category: t.category,
      amount: t.amount,
      date: t.date,
      accountName: t.accountName,
      pendingSync: isPendingId(t.id),
    }))
}

/** Compartidos donde estoy involucrado (compro yo o debo yo). */
export function toInvolvedTxs(
  transactions: OfflineTransaction[],
  accounts: OfflineAccount[],
  shares: OfflineShare[],
  partnerShared: OfflinePartnerShared[],
): ResumenInvolvedTx[] {
  const accById = new Map(accounts.map((a) => [a.id, a]))
  const sharesByTx = new Map<string, OfflineShare[]>()
  for (const s of shares) {
    const arr = sharesByTx.get(s.transactionId) ?? []
    arr.push(s)
    sharesByTx.set(s.transactionId, arr)
  }
  const toShareRows = (list: OfflineShare[]) =>
    list.map((s) => ({
      id: s.id,
      debtorId: s.debtorId,
      debtorName: s.debtorName,
      sharePct: s.sharePct,
      monthlyAmount: s.monthlyAmount,
    }))

  const mine = transactions
    .filter((t) => !t.partnerShare && t.type === 'EXPENSE' && t.isShared)
    .map((t) => {
      const acc = accById.get(t.accountId)
      return {
        id: t.id,
        concept: t.concept,
        amount: t.amount,
        installments: t.installments,
        date: t.date,
        isShared: t.isShared,
        createdById: t.createdById,
        creatorName: t.creatorName,
        statementDay: acc?.statementDay ?? undefined,
        dueDay: acc?.dueDay ?? undefined,
        pendingSync: isPendingId(t.id),
        shares: toShareRows(sharesByTx.get(t.id) ?? []),
      }
    })

  const theirs = partnerShared.map((p) => ({
    id: p.id,
    concept: p.concept,
    amount: p.amount,
    installments: p.installments,
    date: p.date,
    isShared: true,
    createdById: p.createdById,
    creatorName: p.creatorName,
    statementDay: p.statementDay ?? undefined,
    dueDay: p.dueDay ?? undefined,
    pendingSync: isPendingId(p.id),
    shares: toShareRows(sharesByTx.get(p.id) ?? []),
  }))

  return [...mine, ...theirs]
}

/** Lo ya liquidado no suma al "por liquidar". */
export function toConfirmed(
  rows: OfflineLineSum[],
): { key: string; amount: number }[] {
  return rows.map((s) => ({ key: s.key, amount: s.confirmed }))
}

/** Estados de cuenta de MIS tarjetas (deuda vigente + períodos). */
export function deriveStatements(
  accounts: OfflineAccount[],
  transactions: OfflineTransaction[],
): CreditStatementView[] {
  const now = wallNow()
  const cards = accounts
    .filter((a) => a.type === 'CREDIT' && !a.isHidden)
    .sort(
      (x, y) =>
        Number(y.isFavorite) - Number(x.isFavorite) || x.position - y.position,
    )
  const cardIds = new Set(cards.map((c) => c.id))
  const balanceById = new Map(accounts.map((a) => [a.id, a.balance]))

  const cardTxs: StatementTx[] = transactions
    .filter(
      (t) =>
        cardIds.has(t.accountId) ||
        (t.transferToAccountId != null && cardIds.has(t.transferToAccountId)),
    )
    .map((t) => ({
      id: t.id,
      type: t.type as 'EXPENSE' | 'INCOME' | 'TRANSFER',
      amount: t.amount,
      concept: t.concept,
      date: new Date(t.date),
      accountId: t.accountId,
      transferToAccountId: t.transferToAccountId ?? null,
      installments: t.installments,
      statementKey: t.statementKey ?? null,
    }))

  const debitOpts = accounts
    .filter((a) => a.type === 'DEBIT' && !a.isHidden)
    .sort(
      (x, y) =>
        Number(y.isFavorite) - Number(x.isFavorite) || x.position - y.position,
    )
    .map((d) => ({ id: d.id, name: d.name, type: d.type, color: d.color }))

  return cards.map((c) => {
    const txs = cardTxs.filter(
      (t) => t.accountId === c.id || t.transferToAccountId === c.id,
    )
    const opts = {
      statementDay: c.statementDay ?? null,
      dueDay: c.dueDay ?? null,
    }
    const { statements: stmts, currentKey } = activePeriods(
      c.id,
      txs,
      opts,
      now,
    )
    const debt = balanceById.get(c.id) ?? 0
    const limit = c.creditLimit ?? null
    return {
      card: {
        id: c.id,
        name: c.name,
        lastFour: c.lastFour ?? null,
        color: c.color,
        creditLimit: limit,
        statementDay: c.statementDay ?? null,
        dueDay: c.dueDay ?? null,
        currentDebt: debt,
        available: limit != null ? limit - debt : null,
      },
      currentKey,
      debitOpts,
      periods: stmts.map((p) => ({
        ...p,
        start: p.start.toISOString(),
        end: p.end.toISOString(),
        dueDate: p.dueDate?.toISOString() ?? null,
        moves: p.moves.map((m) => ({ ...m, date: m.date.toISOString() })),
      })),
    }
  })
}

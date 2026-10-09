import { redirect } from 'next/navigation'

import type { CreditStatementView } from '@/components/credit-statements'
import { ResumenShell } from '@/components/resumen-shell'

import { getAccountBalances } from '@/lib/balances'
import { getCatalog } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { normalizeMoney } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { type StatementTx, activePeriods } from '@/lib/statements'
import { monthKey, monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey, utc, wallNow } from '@/lib/walltime'

import { auth } from '@/auth'

export const metadata = { title: 'Resumen' }

export default async function ResumenPage() {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  if (!meId) redirect('/login')
  // Base hora-muro (ver lib/walltime.ts): los límites de ventana y el
  // período vigente usan el día real en México, no el UTC del servidor.
  const now = wallNow()
  // Ventana amplia para compartidos: un MSI comprado hace meses sigue
  // generando parcialidad este mes.
  const sharedStart = utc(now.getUTCFullYear(), now.getUTCMonth() - 24, 1)

  // Privacidad: el donut/categorías solo con MIS gastos. La liquidación solo
  // con compartidos donde estoy involucrado (soy quien compra o quien debe).
  // Se trae ventana amplia y el mes se filtra en cliente (como Actividad).
  const [mineRows, sharedRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        date: { gte: sharedStart },
        type: { in: ['EXPENSE', 'INCOME'] },
        createdById: meId,
      },
      include: { account: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.transaction.findMany({
      where: {
        date: { gte: sharedStart },
        type: 'EXPENSE',
        isShared: true,
        OR: [{ createdById: meId }, { shares: { some: { debtorId: meId } } }],
      },
      include: {
        account: { select: { statementDay: true, dueDay: true } },
        createdBy: true,
        shares: { include: { debtor: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ])
  // Donut: MIS movimientos (fecha ISO para filtrar en cliente, como Actividad).
  const mine = mineRows.map((t) => ({
    id: t.id,
    type: t.type as 'EXPENSE' | 'INCOME',
    category: t.category,
    amount: normalizeMoney(t.amount),
    date: t.date.toISOString(),
    accountName: t.account.name,
  }))
  const involved = sharedRows.map((t) => ({
    id: t.id,
    concept: t.concept,
    amount: normalizeMoney(t.amount),
    installments: t.installments,
    date: t.date.toISOString(),
    isShared: t.isShared,
    createdById: t.createdById,
    creatorName: t.createdBy.name,
    statementDay: t.account.statementDay ?? undefined,
    dueDay: t.account.dueDay ?? undefined,
    shares: t.shares.map((s) => ({
      id: s.id,
      debtorId: s.debtor.id,
      debtorName: s.debtor.name,
      sharePct: s.sharePct,
      monthlyAmount: normalizeMoney(s.monthlyAmount),
    })),
  }))

  // Meses con registro (solo gastos suman al total del selector).
  const totals = new Map<string, number>()
  for (const t of mine) {
    if (t.type !== 'EXPENSE') continue
    const k = monthKey(new Date(t.date))
    totals.set(k, (totals.get(k) ?? 0) + t.amount)
  }
  const current = mexicoMonthKey()
  if (!totals.has(current)) totals.set(current, 0)
  const months = [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, total]) => {
      const [y, m] = key.split('-').map(Number)
      return { key, label: monthLabelEs(new Date(y, m - 1, 1)), total }
    })

  // Lo ya liquidado no suma al "por liquidar" (mapa serializado).
  const sums = await getLineSums(
    involved.flatMap((t) => t.shares.map((s) => s.id)),
  )
  const confirmed = [...sums.entries()].map(([k, s]) => ({
    key: k,
    amount: s.confirmed,
  }))

  // Estados de cuenta: tarjetas de crédito propias + sus movimientos.
  // Ventana amplia para no perder MSI largos en la siembra de saldos.
  const stmtStart = utc(now.getUTCFullYear(), now.getUTCMonth() - 30, 1)
  const [cards, debitRows, balances] = await Promise.all([
    prisma.account.findMany({
      where: { userId: meId, isActive: true, isHidden: false, type: 'CREDIT' },
      orderBy: [
        { isFavorite: 'desc' },
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
    }),
    prisma.account.findMany({
      where: { userId: meId, isActive: true, isHidden: false, type: 'DEBIT' },
      select: { id: true, name: true, type: true, color: true },
      orderBy: [
        { isFavorite: 'desc' },
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
    }),
    getAccountBalances(meId),
  ])
  const cardIds = cards.map((c) => c.id)
  const cardTxs = cardIds.length
    ? await prisma.transaction.findMany({
        where: {
          date: { gte: stmtStart },
          OR: [
            { accountId: { in: cardIds } },
            { transferToAccountId: { in: cardIds } },
          ],
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      })
    : []

  const catalog = await getCatalog(meId)

  const statements: CreditStatementView[] = cards.map((c) => {
    const txs: StatementTx[] = cardTxs
      .filter((t) => t.accountId === c.id || t.transferToAccountId === c.id)
      .map((t) => ({
        id: t.id,
        type: t.type as 'EXPENSE' | 'INCOME' | 'TRANSFER',
        amount: normalizeMoney(t.amount),
        concept: t.concept,
        date: t.date,
        accountId: t.accountId,
        transferToAccountId: t.transferToAccountId,
        installments: t.installments,
        statementKey: t.statementKey ?? null,
      }))
    const opts = { statementDay: c.statementDay, dueDay: c.dueDay }
    const { statements: stmts, currentKey } = activePeriods(
      c.id,
      txs,
      opts,
      now,
    )
    const debt = balances.get(c.id) ?? 0
    const limit = c.creditLimit != null ? Number(c.creditLimit) : null
    return {
      card: {
        id: c.id,
        name: c.name,
        lastFour: c.lastFour,
        color: c.color ?? '#6366f1',
        creditLimit: limit,
        statementDay: c.statementDay,
        dueDay: c.dueDay,
        currentDebt: debt,
        available: limit != null ? limit - debt : null,
      },
      currentKey,
      debitOpts: debitRows.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type as 'DEBIT' | 'CREDIT',
        color: d.color ?? '#6366f1',
      })),
      periods: stmts.map((p) => ({
        ...p,
        start: p.start.toISOString(),
        end: p.end.toISOString(),
        dueDate: p.dueDate?.toISOString() ?? null,
        moves: p.moves.map((m) => ({ ...m, date: m.date.toISOString() })),
      })),
    }
  })

  return (
    <>
      <ResumenShell
        months={months}
        mine={mine}
        involved={involved}
        confirmed={confirmed}
        cats={catalog}
        statements={statements}
      />
    </>
  )
}

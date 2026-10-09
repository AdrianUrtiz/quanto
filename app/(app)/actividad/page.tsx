import { redirect } from 'next/navigation'

import { ActividadShell } from '@/components/actividad-shell'
import { type MonthOpt } from '@/components/activity-client'
import type {
  SourceConfirmItem,
  ToConfirmItem,
} from '@/components/cuentas-client'
import type { TxRow } from '@/components/transaction-list'

import { getCardPayCandidates } from '@/lib/card-pay-server'
import { getCatalog } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { fromCents, normalizeMoney, toCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { monthKey, monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey } from '@/lib/walltime'

import { auth } from '@/auth'

export const metadata = { title: 'Actividad' }

export default async function ActividadPage() {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  if (!meId) redirect('/login')

  // Sin cota inferior: "Todo el tiempo" debe ser literal (escala personal).

  // Privacidad: solo MIS movimientos. Lo que gasta mi pareja no aparece aquí;
  // lo que le debo vive en Cuentas > Mi pareja y en el Resumen.
  const [rows, partnerRows, accRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { createdById: meId },
      include: { account: true, createdBy: true },
      // Desempate por creación: varios movimientos pueden compartir fecha+hora
      // (mediodías fijos históricos, cargos de suscripción).
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    // Compartidos de mi pareja donde YO soy el deudor: solo lectura con MI
    // parte (el gasto completo nunca tocó mis cuentas). Sin datos de sus
    // cuentas: solo concepto, categoría, fecha y quién lo creó.
    prisma.transaction.findMany({
      where: {
        type: 'EXPENSE',
        isShared: true,
        createdById: { not: meId },
        shares: { some: { debtorId: meId } },
      },
      include: {
        createdBy: true,
        shares: { where: { debtorId: meId } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.account.findMany({
      where: { userId: meId },
      select: { id: true, name: true, type: true, color: true },
      orderBy: [
        { isFavorite: 'desc' },
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
    }),
  ])
  const accById = new Map(accRows.map((a) => [a.id, a]))
  const raw = rows.map((t) => ({
    id: t.id,
    concept: t.concept,
    category: t.category,
    amount: normalizeMoney(t.amount),
    date: t.date,
    type: t.type,
    accountId: t.accountId,
    accountName: t.account.name,
    accountType: t.account.type,
    transferToAccountId: t.transferToAccountId ?? null,
    transferToAccountName: t.transferToAccountId
      ? (accById.get(t.transferToAccountId)?.name ?? null)
      : null,
    transferToAccountType: t.transferToAccountId
      ? (accById.get(t.transferToAccountId)?.type ?? null)
      : null,
    creatorName: t.createdBy.name,
    installments: t.installments,
    isShared: t.isShared,
    createdById: t.createdById,
    partnerShare: false,
  }))
  // Mi parte de sus gastos compartidos: una fila por compra con el total
  // que me toca (mensual × parcialidades), en el mes de compra.
  const mine = partnerRows.map((t) => {
    const monthly = normalizeMoney(t.shares[0]?.monthlyAmount ?? 0)
    const n = Math.max(1, Math.round(t.installments))
    return {
      id: `partner-${t.id}`,
      concept: t.concept,
      category: t.category,
      amount: fromCents(toCents(monthly) * n),
      date: t.date,
      type: 'EXPENSE',
      accountId: '',
      accountName: '',
      accountType: 'DEBIT',
      transferToAccountId: null,
      transferToAccountName: null,
      transferToAccountType: null,
      creatorName: t.createdBy.name,
      installments: t.installments,
      isShared: true,
      createdById: t.createdById,
      partnerShare: true,
    }
  })
  const all = [...raw, ...mine].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  )

  // Movimientos huella de pagos CONFIRMED (ingreso del cobro o egreso del
  // origen): solo lectura, sin acciones de editar/eliminar.
  const lockedRows = await prisma.debtPayment.findMany({
    where: {
      status: 'CONFIRMED',
      share: {
        OR: [{ debtorId: meId }, { transaction: { createdById: meId } }],
      },
    },
    select: { transactionId: true, debtorTransactionId: true },
  })
  const lockedTxIds = new Set(
    lockedRows
      .flatMap((p) => [p.transactionId, p.debtorTransactionId])
      .filter((id) => id != null),
  )

  const txs: TxRow[] = all.map((t) => ({
    ...t,
    date: t.date.toISOString(),
    locked: t.partnerShare || lockedTxIds.has(t.id),
  }))
  const catalog = await getCatalog(meId)

  // Meses con registro (solo gastos suman al total del selector,
  // incluyendo mi parte de sus compartidos).
  const totals = new Map<string, number>()
  for (const t of all) {
    if (t.type !== 'EXPENSE') continue
    const k = monthKey(new Date(t.date))
    totals.set(k, (totals.get(k) ?? 0) + t.amount)
  }
  const current = mexicoMonthKey()
  if (!totals.has(current)) totals.set(current, 0)
  const months: MonthOpt[] = [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, total]) => {
      const [y, m] = key.split('-').map(Number)
      return { key, label: monthLabelEs(new Date(y, m - 1, 1)), total }
    })

  // Pagos de pareja pendientes de mi confirmación + mis cuentas (destino).
  const [mineAccounts, pendingRows, sourceRows] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true, isHidden: false, userId: meId },
      select: {
        id: true,
        name: true,
        type: true,
        lastFour: true,
        expiry: true,
        color: true,
        isFavorite: true,
      },
      orderBy: [
        { isFavorite: 'desc' },
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
    }),
    prisma.debtPayment.findMany({
      where: {
        status: 'PENDING',
        share: {
          OR: [{ debtorId: meId }, { transaction: { createdById: meId } }],
        },
      },
      include: {
        share: { include: { transaction: true } },
        registeredBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.debtPayment.findMany({
      where: {
        status: 'CONFIRMED',
        debtorConfirmedAt: null,
        registeredById: { not: meId },
        share: { debtorId: meId },
      },
      include: {
        share: { include: { transaction: { include: { createdBy: true } } } },
        registeredBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  const accountOptions = mineAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as 'DEBIT' | 'CREDIT',
    color: a.color ?? '#6366f1',
    isFavorite: a.isFavorite,
  }))
  const toConfirm: ToConfirmItem[] = pendingRows
    .filter((p) => p.registeredById !== meId)
    .map((p) => {
      const [y, mo] = p.month.split('-').map(Number)
      return {
        id: p.id,
        amount: normalizeMoney(p.amount),
        month: p.month,
        monthLabel: monthLabelEs(new Date(y, mo - 1, 1)),
        concept: p.share.transaction.concept,
        monthly: normalizeMoney(p.share.monthlyAmount),
        shareId: p.shareId,
        registeredByName: p.registeredBy.name,
      }
    })
  const toConfirmSource: SourceConfirmItem[] = sourceRows.map((p) => {
    const [y, mo] = p.month.split('-').map(Number)
    return {
      id: p.id,
      amount: normalizeMoney(p.amount),
      month: p.month,
      monthLabel: monthLabelEs(new Date(y, mo - 1, 1)),
      concept: p.share.transaction.concept,
      creditorName: p.registeredBy.name,
    }
  })

  // Recordatorio "Pagar a tu pareja": lo que YO debo de sus tarjetas
  // (mismo origen que Cuentas > Pareja; sin datos de sus cuentas, solo
  // concepto, corte/límite y mi parte). Si no debo nada, lista vacía.
  const meName = session?.user?.name ?? 'Tú'
  const sharedOwed = await prisma.transaction.findMany({
    where: {
      isShared: true,
      createdById: { not: meId },
      shares: { some: { debtorId: meId } },
    },
    include: {
      account: true,
      createdBy: true,
      shares: { where: { debtorId: meId } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
  const partnerDebtItems = sharedOwed.map((t) => ({
    shareId: t.shares[0]?.id ?? '',
    accountId: t.account.id,
    accountName: t.account.name,
    accountType: t.account.type as 'DEBIT' | 'CREDIT',
    dueDay: t.account.dueDay ?? undefined,
    statementDay: t.account.statementDay ?? undefined,
    debtorId: meId,
    debtorName: meName,
    creditorName: t.createdBy.name,
    concept: t.concept,
    monthly: normalizeMoney(t.shares[0]?.monthlyAmount ?? 0),
    installments: t.installments,
    date: t.date.toISOString(),
  }))
  const partnerSums = await getLineSums(
    sharedOwed.flatMap((t) => t.shares.map((s) => s.id)),
  )
  // Recordatorio "Pagar tus tarjetas": cierre del periodo vigente de MIS
  // créditos con día de pago (propietario). Se apaga al liquidar.
  const cardPayItems = await getCardPayCandidates(meId)

  return (
    <ActividadShell
      txs={txs}
      months={months}
      cats={catalog}
      filterAccounts={accountOptions}
      expiryAccounts={mineAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        lastFour: a.lastFour,
        expiry: a.expiry,
        color: a.color ?? '#6366f1',
      }))}
      partnerDebtItems={partnerDebtItems}
      partnerSums={[...partnerSums.entries()].map(([k, s]) => ({
        key: k,
        confirmed: s.confirmed,
        pending: s.pending,
      }))}
      cardPayItems={cardPayItems}
      toConfirm={toConfirm}
      toConfirmSource={toConfirmSource}
    />
  )
}

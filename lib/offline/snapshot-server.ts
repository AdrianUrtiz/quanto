// Construye el snapshot offline de UN usuario (Etapa 1: solo lectura).
//
// Alcance estricto: solo datos del usuario de la sesión + relacionados
// (compartidos donde soy creador o deudor, suscripciones compartidas de
// la pareja). Nunca cuentas/saldos privados de otros usuarios: de la
// pareja solo viajan mínimos desnormalizados (nombres, concepto, montos
// mensuales), igual que ya hacen las páginas de actividad/cuentas.
//
// Ventana: últimos 12 meses + MSI/gastos viejos que sigan exigibles
// dentro de la ventana (installments hasta 24).
import { getAccountBalances } from '@/lib/balances'
import { getCardPayCandidates } from '@/lib/card-pay-server'
import { getCatalog } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { normalizeMoney } from '@/lib/money'
import type { OfflineAccount, OfflineTransaction } from '@/lib/offline/db'
import { SNAPSHOT_VERSION } from '@/lib/offline/db'
import type { SnapshotPayload } from '@/lib/offline/snapshot'
import { prisma } from '@/lib/prisma'
import { getSubscriptionData } from '@/lib/subscription-actions'
import { monthShortOf } from '@/lib/subscriptions'
import { monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey, utc } from '@/lib/walltime'

/** "YYYY-MM" del mes de la última parcialidad de un MSI comprado en `date`. */
function endMonthKey(date: Date, installments: number): string {
  const n = Math.max(1, Math.round(installments)) - 1
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

function monthLabelOf(month: string): string {
  const [y, mo] = month.split('-').map(Number)
  return monthLabelEs(new Date(y, mo - 1, 1))
}

export async function buildSnapshot(userId: string): Promise<SnapshotPayload> {
  const now = new Date()
  // Primer día de hace 12 meses (comparación por fecha) y mes "YYYY-MM".
  const cutoff = utc(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)
  const cutoffMonth = cutoff.toISOString().slice(0, 7)
  // Piso para MSI viejos: un 24-MSI comprado hace 35 meses termina justo
  // en el borde de la ventana (35 = 12 ventana + 23 de arrastre máximo).
  const msiFloor = utc(now.getUTCFullYear(), now.getUTCMonth() - 35, 1)
  const currentMonth = mexicoMonthKey()
  const takenAt = new Date().toISOString()

  const [accRows, balances, catalog, cardPayItems, subData, me] =
    await Promise.all([
      prisma.account.findMany({
        where: { isActive: true, userId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      getAccountBalances(userId),
      getCatalog(userId),
      getCardPayCandidates(userId),
      getSubscriptionData(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
    ])
  const meName = me?.name ?? 'Tú'

  const accounts: OfflineAccount[] = accRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as 'DEBIT' | 'CREDIT',
    owner: a.user.name,
    ownerId: a.user.id,
    balance:
      balances.get(a.id) ??
      (a.type === 'DEBIT' ? normalizeMoney(a.initialBalance ?? 0) : 0),
    creditLimit: a.creditLimit ? normalizeMoney(a.creditLimit) : undefined,
    statementDay: a.statementDay ?? undefined,
    dueDay: a.dueDay ?? undefined,
    lastFour: a.lastFour ?? undefined,
    expiry: a.expiry ?? undefined,
    color: a.color ?? '#6366f1',
    isHidden: a.isHidden,
    updatedAt: a.updatedAt.toISOString(),
  }))
  const accById = new Map(accRows.map((a) => [a.id, a]))

  // — Movimientos míos (ventana + MSI viejos aún exigibles) —
  const [mineRecent, mineOldMsi] = await Promise.all([
    prisma.transaction.findMany({
      where: { createdById: userId, date: { gte: cutoff } },
      include: { account: true, createdBy: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.transaction.findMany({
      where: {
        createdById: userId,
        type: 'EXPENSE',
        installments: { gt: 1 },
        date: { gte: msiFloor, lt: cutoff },
      },
      include: { account: true, createdBy: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ])
  const seen = new Set<string>()
  const mineAll = [...mineRecent, ...mineOldMsi].filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    if (t.date < cutoff && endMonthKey(t.date, t.installments) < cutoffMonth)
      return false
    return true
  })

  // — Compartidos de mi pareja donde YO soy el deudor (solo lectura,
  // sin datos de sus cuentas salvo nombre/tipo/corte para el recordatorio) —
  const [partnerRecent, partnerOldMsi] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        type: 'EXPENSE',
        isShared: true,
        createdById: { not: userId },
        date: { gte: cutoff },
        shares: { some: { debtorId: userId } },
      },
      include: {
        account: true,
        createdBy: true,
        shares: { where: { debtorId: userId } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.transaction.findMany({
      where: {
        type: 'EXPENSE',
        isShared: true,
        createdById: { not: userId },
        installments: { gt: 1 },
        date: { gte: msiFloor, lt: cutoff },
        shares: { some: { debtorId: userId } },
      },
      include: {
        account: true,
        createdBy: true,
        shares: { where: { debtorId: userId } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ])
  const partnerAll = [...partnerRecent, ...partnerOldMsi].filter(
    (t) =>
      t.date >= cutoff || endMonthKey(t.date, t.installments) >= cutoffMonth,
  )

  // — Compras MÍAS compartidas donde mi pareja es deudora (me deben) —
  const sharedOwed = await prisma.transaction.findMany({
    where: {
      isShared: true,
      createdById: userId,
      date: { gte: cutoff },
      shares: { some: { debtorId: { not: userId } } },
    },
    include: {
      account: true,
      createdBy: true,
      shares: { include: { debtor: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })

  const transactions: OfflineTransaction[] = [
    ...mineAll.map((t) => ({
      id: t.id,
      concept: t.concept,
      category: t.category,
      amount: normalizeMoney(t.amount),
      date: t.date.toISOString(),
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
      createdById: t.createdById,
      installments: t.installments,
      isShared: t.isShared,
      partnerShare: false as const,
      statementKey: t.statementKey ?? null,
      updatedAt: t.updatedAt.toISOString(),
    })),
    // Mi parte de sus gastos: una fila por compra con el total que me toca.
    ...partnerAll.map((t) => {
      const monthly = normalizeMoney(t.shares[0]?.monthlyAmount ?? 0)
      const n = Math.max(1, Math.round(t.installments))
      return {
        id: `partner-${t.id}`,
        concept: t.concept,
        category: t.category,
        amount: normalizeMoney(monthly * n),
        date: t.date.toISOString(),
        type: 'EXPENSE',
        accountId: '',
        accountName: '',
        accountType: 'DEBIT',
        transferToAccountId: null,
        transferToAccountName: null,
        transferToAccountType: null,
        creatorName: t.createdBy.name,
        createdById: t.createdById,
        installments: t.installments,
        isShared: true,
        partnerShare: true as const,
        statementKey: null,
        updatedAt: t.updatedAt.toISOString(),
      }
    }),
  ]

  // — Shares de mis compartidos + los que me tocan —
  const mySharedIds = mineAll.filter((t) => t.isShared).map((t) => t.id)
  const myShares =
    mySharedIds.length > 0
      ? await prisma.transactionShare.findMany({
          where: { transactionId: { in: mySharedIds } },
          include: { debtor: true },
        })
      : []
  const shares: SnapshotPayload['shares'] = [
    ...myShares.map((s) => ({
      id: s.id,
      transactionId: s.transactionId,
      debtorId: s.debtorId,
      debtorName: s.debtor.name,
      sharePct: s.sharePct,
      monthlyAmount: normalizeMoney(s.monthlyAmount),
      isFixedAmount: s.isFixedAmount,
    })),
    ...partnerAll.flatMap((t) =>
      t.shares.map((s) => ({
        id: s.id,
        transactionId: t.id,
        debtorId: userId,
        debtorName: meName,
        sharePct: s.sharePct,
        monthlyAmount: normalizeMoney(s.monthlyAmount),
        isFixedAmount: s.isFixedAmount,
      })),
    ),
    ...sharedOwed.flatMap((t) =>
      t.shares.map((s) => ({
        id: s.id,
        transactionId: t.id,
        debtorId: s.debtorId,
        debtorName: s.debtor.name,
        sharePct: s.sharePct,
        monthlyAmount: normalizeMoney(s.monthlyAmount),
        isFixedAmount: s.isFixedAmount,
      })),
    ),
  ]
  const allShareIds = shares.map((s) => s.id)

  const [sums, pendingRows, sourceRows] = await Promise.all([
    getLineSums(allShareIds),
    prisma.debtPayment.findMany({
      where: {
        status: 'PENDING',
        share: {
          OR: [{ debtorId: userId }, { transaction: { createdById: userId } }],
        },
      },
      include: {
        share: {
          include: {
            transaction: { include: { createdBy: true } },
            debtor: true,
          },
        },
        registeredBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.debtPayment.findMany({
      where: {
        status: 'CONFIRMED',
        debtorConfirmedAt: null,
        registeredById: { not: userId },
        share: { debtorId: userId },
      },
      include: {
        share: { include: { transaction: { include: { createdBy: true } } } },
        registeredBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Huella de pagos CONFIRMED → movimientos bloqueados (solo lectura).
  const lockedRows = await prisma.debtPayment.findMany({
    where: {
      status: 'CONFIRMED',
      share: {
        OR: [{ debtorId: userId }, { transaction: { createdById: userId } }],
      },
    },
    select: { transactionId: true, debtorTransactionId: true },
  })
  const lockedTxIds = new Set(
    lockedRows
      .flatMap((p) => [p.transactionId, p.debtorTransactionId])
      .filter((id): id is string => id != null),
  )
  for (const t of transactions) {
    if (t.partnerShare || lockedTxIds.has(t.id)) t.locked = true
  }

  const toConfirm: SnapshotPayload['debtPayments']['toConfirm'] = []
  const myPending: SnapshotPayload['debtPayments']['myPending'] = []
  for (const p of pendingRows) {
    // Cota 12m por mes, salvo pendientes aún no liquidados (siguen debidos).
    if (p.month < cutoffMonth) continue
    const base = {
      id: p.id,
      shareId: p.shareId,
      month: p.month,
      monthLabel: monthLabelOf(p.month),
      amount: normalizeMoney(p.amount),
      status: 'PENDING' as const,
      registeredById: p.registeredById,
      registeredByName: p.registeredBy.name,
      concept: p.share.transaction.concept,
      monthly: normalizeMoney(p.share.monthlyAmount),
    }
    if (p.registeredById === userId) {
      myPending.push({
        ...base,
        registeredByName: p.share.transaction.createdBy.name,
      })
    } else {
      toConfirm.push(base)
    }
  }
  const toConfirmSource = sourceRows
    .filter((p) => p.month >= cutoffMonth)
    .map((p) => ({
      id: p.id,
      shareId: p.shareId,
      month: p.month,
      monthLabel: monthLabelOf(p.month),
      amount: normalizeMoney(p.amount),
      status: 'CONFIRMED' as const,
      registeredById: p.registeredById,
      registeredByName: p.registeredBy.name,
      concept: p.share.transaction.concept,
      monthly: normalizeMoney(p.share.monthlyAmount),
    }))

  // Cargos con filas completas (para dues e historial en cliente).
  // Ventana de 12m: computeDues mira 6 meses atrás y el historial 6.
  const subIds = subData.subs.map((s) => s.id)
  const chargeRows =
    subIds.length > 0
      ? await prisma.subscriptionCharge.findMany({
          where: {
            subscriptionId: { in: subIds },
            month: { gte: cutoffMonth },
          },
          include: {
            ownerPaidBy: { select: { name: true } },
            partnerPaidBy: { select: { name: true } },
          },
        })
      : []
  const isSharedBySub = new Map(subData.subs.map((s) => [s.id, s.isShared]))

  // Deudas de pareja desnormalizadas (lo que debo + lo que me deben).
  // Solo mínimos: nombres, concepto y mensualidad. Sin saldos ajenos.
  const partnerDebts: SnapshotPayload['partnerDebts'] = [
    ...partnerAll.map((t) => ({
      shareId: t.shares[0]?.id ?? '',
      accountId: t.account.id,
      accountName: t.account.name,
      accountType: t.account.type as 'DEBIT' | 'CREDIT',
      dueDay: t.account.dueDay ?? null,
      statementDay: t.account.statementDay ?? null,
      debtorId: userId,
      debtorName: meName,
      creditorName: t.createdBy.name,
      concept: t.concept,
      monthly: normalizeMoney(t.shares[0]?.monthlyAmount ?? 0),
      installments: t.installments,
      date: t.date.toISOString(),
      direction: 'owe' as const,
    })),
    ...sharedOwed.flatMap((t) =>
      t.shares
        .filter((s) => s.debtorId !== userId)
        .map((s) => ({
          shareId: s.id,
          accountId: t.account.id,
          accountName: t.account.name,
          accountType: t.account.type as 'DEBIT' | 'CREDIT',
          dueDay: t.account.dueDay ?? null,
          statementDay: t.account.statementDay ?? null,
          debtorId: s.debtorId,
          debtorName: s.debtor.name,
          creditorName: t.createdBy.name,
          concept: t.concept,
          monthly: normalizeMoney(s.monthlyAmount ?? 0),
          installments: t.installments,
          date: t.date.toISOString(),
          direction: 'owed' as const,
        })),
    ),
  ]

  // Compras compartidas de mi pareja en bruto (liquidación del Resumen).
  const partnerShared: SnapshotPayload['partnerShared'] = partnerAll.map(
    (t) => ({
      id: t.id,
      concept: t.concept,
      amount: normalizeMoney(t.amount),
      installments: t.installments,
      date: t.date.toISOString(),
      createdById: t.createdById,
      creatorName: t.createdBy.name,
      statementDay: t.account.statementDay ?? null,
      dueDay: t.account.dueDay ?? null,
    }),
  )

  return {
    v: SNAPSHOT_VERSION,
    userId,
    takenAt,
    accounts,
    transactions,
    shares,
    partnerShared,
    debtPayments: { toConfirm, myPending, toConfirmSource },
    lineSums: [...sums.entries()].map(([key, s]) => ({
      key,
      confirmed: s.confirmed,
      pending: s.pending,
    })),
    catalog: catalog.map((c) => ({
      code: c.code,
      name: c.name,
      iconName: c.iconName,
      color: c.color,
      kind: c.kind,
      isDefault: c.isDefault,
      mine: c.mine,
    })),
    subscriptions: subData.subs.map((s) => ({
      id: s.id,
      name: s.name,
      amount: s.amount,
      category: s.category,
      accountId: s.accountId,
      accountName: s.accountName,
      accountType: s.accountType,
      chargeDay: s.chargeDay,
      isShared: s.isShared,
      sharePct: s.sharePct,
      shareAmount: s.shareAmount,
      isActive: s.isActive,
      startMonth: s.startMonth,
      ownerName: s.ownerName,
      isMine: s.isMine,
      partnerName: s.partnerName,
    })),
    // Filas completas acotadas a la ventana (dues e historial en cliente).
    charges: chargeRows.map((c) => ({
      key: `${c.subscriptionId}:${c.month}`,
      subscriptionId: c.subscriptionId,
      month: c.month,
      short: monthShortOf(c.month),
      confirmed: !c.skipped && c.transactionId != null,
      partnerPaid: c.partnerPaid,
      skipped: c.skipped,
      isShared: isSharedBySub.get(c.subscriptionId) ?? false,
      transactionId: c.transactionId,
      ownerPaid: c.ownerPaid,
      ownerPaidByName: c.ownerPaidBy?.name ?? null,
      partnerPaidByName: c.partnerPaidBy?.name ?? null,
    })),
    cardPayItems,
    partnerDebts,
    currentMonth,
  }
}

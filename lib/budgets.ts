// Presupuesto mensual individual (sección Presupuestos).
//
// Mes calendario "YYYY-MM" (no período de corte bancario).
//
// - Ingreso = monto manual capturado (baseIncome). Los movimientos INCOME
//   no suman al presupuesto: si ganas algo extra, súmalo a mano al ingreso.
// - Comprometido por cuenta = parcialidades MSI del mes que caen en esa
//   cuenta (monto total, incluyendo lo compartido: es lo que se carga a la
//   tarjeta) + suscripciones propias esperadas sin confirmar + fijos
//   manuales atados a la cuenta.
// - Lo que debo a mi pareja (settleMonth donde soy deudor) suma al
//   comprometido total como línea aparte (efectivo por pagar).
// - Lo que me deben es solo informativo (criterio conservador: no resta).
// - Gastado por categoría = parcialidades del mes de mis EXPENSE +
//   suscripciones esperadas sin confirmar, agrupado por categoría.
//   Los límites (BudgetCategoryLimit) se comparan contra ese usado.
import {
  installmentMonths,
  monthlyTotal,
  settleMonth,
} from '@/lib/calculations'
import { getCatalog } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { fromCents, normalizeMoney, toCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 0, 23, 59, 59, 999),
  }
}

export function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export type BudgetAccountLine = {
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  auto: number // MSI + suscripciones esperadas
  manual: number // fijos atados a la cuenta
  total: number
  details: { label: string; amount: number }[]
}

export type BudgetCategoryLine = {
  category: string
  limit: number | null
  used: number
}

export type BudgetView = {
  month: string
  baseIncome: number
  incomeTotal: number
  accounts: BudgetAccountLine[]
  manualGeneral: number
  manualGeneralDetails: { label: string; amount: number }[]
  partnerOwed: number // debo aportar a mi pareja
  partnerOwedDetails: { concept: string; amount: number }[]
  partnerDueToMe: number // me deben (informativo)
  committedTotal: number
  available: number
  /** 0-1+ gastado del comprometido; >1 = sobregiro. */
  spentRatio: number
  categories: BudgetCategoryLine[]
}

type ManualItem = { label: string; amount: number; accountId: string | null }
type CatLimit = { category: string; limit: number }

export async function getBudgetManual(
  userId: string,
  month: string,
): Promise<{ baseIncome: number; items: ManualItem[]; limits: CatLimit[] }> {
  if (!process.env.DATABASE_URL || !userId || !MONTH_RE.test(month))
    return { baseIncome: 0, items: [], limits: [] }
  const b = await prisma.budget.findUnique({
    where: { userId_month: { userId, month } },
    include: { items: true, limits: true },
  })
  if (!b) return { baseIncome: 0, items: [], limits: [] }
  return {
    baseIncome: normalizeMoney(b.baseIncome),
    items: b.items.map((i) => ({
      label: i.label,
      amount: normalizeMoney(i.amount),
      accountId: i.accountId,
    })),
    limits: b.limits.map((l) => ({
      category: l.category,
      limit: normalizeMoney(l.limit),
    })),
  }
}

/**
 * Vista completa del presupuesto del mes. Todo en pesos exactos.
 * Privacidad: solo cuentas y movimientos propios; de compartidos solo las
 * líneas donde participo (soy creador o deudor).
 */
export async function getBudgetView(
  userId: string,
  month: string,
): Promise<BudgetView> {
  const empty: BudgetView = {
    month,
    baseIncome: 0,
    incomeTotal: 0,
    accounts: [],
    manualGeneral: 0,
    manualGeneralDetails: [],
    partnerOwed: 0,
    partnerOwedDetails: [],
    partnerDueToMe: 0,
    committedTotal: 0,
    available: 0,
    spentRatio: 0,
    categories: [],
  }
  if (!process.env.DATABASE_URL || !userId || !MONTH_RE.test(month))
    return empty

  const { start, end } = monthRange(month)
  // Ventana amplia para no perder MSI largos en parcialidades del mes.
  const lookback = new Date(start.getFullYear(), start.getMonth() - 24, 1)

  const [manual, accounts, myTxs, involved, subs, charges] = await Promise.all([
    getBudgetManual(userId, month),
    prisma.account.findMany({
      where: { userId, isActive: true, isHidden: false },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.transaction.findMany({
      where: {
        createdById: userId,
        type: 'EXPENSE',
        date: { gte: lookback, lte: end },
      },
      include: { shares: true },
      orderBy: { date: 'desc' },
    }),
    prisma.transaction.findMany({
      where: {
        date: { gte: lookback, lte: end },
        type: 'EXPENSE',
        isShared: true,
        OR: [
          { createdById: userId },
          { shares: { some: { debtorId: userId } } },
        ],
      },
      include: {
        createdBy: true,
        shares: { include: { debtor: true } },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.subscription.findMany({
      where: { userId, isActive: true, startMonth: { lte: month } },
    }),
    prisma.subscriptionCharge.findMany({
      where: { month },
      select: { subscriptionId: true, skipped: true, transactionId: true },
    }),
  ])

  // Liquidación de pareja del mes (lo ya confirmado no suma).
  const shareIds = involved.flatMap((t) => t.shares.map((s) => s.id))
  const sums = await getLineSums(shareIds)
  const settlement = settleMonth(
    involved.map((t) => ({
      id: t.id,
      concept: t.concept,
      amount: normalizeMoney(t.amount),
      installments: t.installments,
      date: t.date,
      isShared: t.isShared,
      createdById: t.createdById,
      creatorName: t.createdBy.name,
      shares: t.shares.map((s) => ({
        id: s.id,
        debtorId: s.debtor.id,
        debtorName: s.debtor.name,
        sharePct: s.sharePct,
        monthlyAmount: normalizeMoney(s.monthlyAmount),
      })),
    })),
    month,
    new Map([...sums.entries()].map(([k, s]) => [k, s.confirmed])),
  )
  let owedC = 0
  let dueToMeC = 0
  const owedDetails: { concept: string; amount: number }[] = []
  for (const line of settlement) {
    const lineC = toCents(line.amount)
    if (line.debtorId === userId) {
      owedC += lineC
      for (const d of line.details)
        owedDetails.push({ concept: d.concept, amount: d.monthly })
    } else {
      dueToMeC += lineC
    }
  }

  // Comprometido automático por cuenta desde mis EXPENSE del mes.
  // Clave: parcialidad total que cae en la tarjeta (incluye lo compartido).
  const autoC = new Map<string, number>()
  const autoDetails = new Map<string, { label: string; amount: number }[]>()
  const catUsedC = new Map<string, number>()
  const pushAuto = (accountId: string, label: string, cents: number) => {
    if (cents <= 0) return
    autoC.set(accountId, (autoC.get(accountId) ?? 0) + cents)
    const arr = autoDetails.get(accountId) ?? []
    arr.push({ label, amount: fromCents(cents) })
    autoDetails.set(accountId, arr)
  }
  const pushCat = (category: string, cents: number) => {
    if (cents <= 0) return
    catUsedC.set(category, (catUsedC.get(category) ?? 0) + cents)
  }

  for (const t of myTxs) {
    if (t.type !== 'EXPENSE') continue
    const months = installmentMonths(t.date, t.installments)
    const idx = months.indexOf(month)
    if (idx === -1) continue
    const sliceC = toCents(
      monthlyTotal(normalizeMoney(t.amount), t.installments),
    )
    if (sliceC <= 0) continue
    pushAuto(
      t.accountId,
      t.installments > 1
        ? `${t.concept} (${idx + 1}/${t.installments} MSI)`
        : t.concept,
      sliceC,
    )
    pushCat(t.category, sliceC)
  }

  // Suscripciones propias esperadas sin confirmar: si el cargo del mes no
  // tiene movimiento ligado, aún no está en mis txs y se suma como esperado.
  // (Confirmado u omitido → no suma: ya está en txs o no se cobró.)
  const chargedBySub = new Map(charges.map((c) => [c.subscriptionId, c]))
  for (const s of subs) {
    const row = chargedBySub.get(s.id)
    if (row && (row.skipped || row.transactionId)) continue
    const amtC = toCents(s.amount)
    if (amtC <= 0) continue
    pushAuto(s.accountId, `${s.name} (suscripción esperada)`, amtC)
    pushCat(s.category, amtC)
  }

  // Fijos manuales: por cuenta o generales.
  const manualByAccC = new Map<string, number>()
  let manualGeneralC = 0
  const manualGeneralDetails: { label: string; amount: number }[] = []
  for (const it of manual.items) {
    const c = toCents(it.amount)
    if (c <= 0) continue
    if (it.accountId) {
      manualByAccC.set(it.accountId, (manualByAccC.get(it.accountId) ?? 0) + c)
    } else {
      manualGeneralC += c
      manualGeneralDetails.push({ label: it.label, amount: fromCents(c) })
    }
  }

  const accountLines: BudgetAccountLine[] = accounts.map((a) => {
    const aC = autoC.get(a.id) ?? 0
    const mC = manualByAccC.get(a.id) ?? 0
    const details = [...(autoDetails.get(a.id) ?? [])]
    for (const it of manual.items) {
      if (it.accountId === a.id && toCents(it.amount) > 0)
        details.push({ label: `${it.label} (fijo)`, amount: it.amount })
    }
    return {
      accountId: a.id,
      accountName: a.name,
      accountType: a.type as 'DEBIT' | 'CREDIT',
      auto: fromCents(aC),
      manual: fromCents(mC),
      total: fromCents(aC + mC),
      details,
    }
  })

  const limitByCat = new Map(manual.limits.map((l) => [l.category, l.limit]))
  const categories: BudgetCategoryLine[] = [
    ...new Set([...catUsedC.keys(), ...limitByCat.keys()]),
  ]
    .map((category) => ({
      category,
      limit: limitByCat.get(category) ?? null,
      used: fromCents(catUsedC.get(category) ?? 0),
    }))
    .sort((a, b) => b.used - a.used)

  // Ingreso 100% manual: lo que captures como base, sin sumar movimientos.
  const incomeC = toCents(manual.baseIncome)
  const accountsC = accountLines.reduce((a, l) => a + toCents(l.total), 0)
  const committedC = accountsC + manualGeneralC + owedC
  const availableC = incomeC - committedC

  return {
    month,
    baseIncome: fromCents(incomeC),
    incomeTotal: fromCents(incomeC),
    accounts: accountLines,
    manualGeneral: fromCents(manualGeneralC),
    manualGeneralDetails,
    partnerOwed: fromCents(owedC),
    partnerOwedDetails: owedDetails,
    partnerDueToMe: fromCents(dueToMeC),
    committedTotal: fromCents(committedC),
    available: fromCents(availableC),
    spentRatio: incomeC > 0 ? committedC / incomeC : committedC > 0 ? 1 : 0,
    categories,
  }
}

export type BudgetItemRow = {
  id: string
  label: string
  amount: number
  accountId: string | null
  accountName: string | null
}

export type BudgetLimitRow = {
  category: string
  label: string
  color: string
  limit: number
  used: number
}

export type BudgetPageData = {
  view: BudgetView
  items: BudgetItemRow[]
  limits: BudgetLimitRow[]
}

/**
 * Todo lo que la pantalla necesita para un mes, en tipos serializables
 * (apto para devolver desde una server action al cliente).
 */
export async function getBudgetPageData(
  userId: string,
  month: string,
): Promise<BudgetPageData> {
  const empty: BudgetPageData = {
    view: {
      month,
      baseIncome: 0,
      incomeTotal: 0,
      accounts: [],
      manualGeneral: 0,
      manualGeneralDetails: [],
      partnerOwed: 0,
      partnerOwedDetails: [],
      partnerDueToMe: 0,
      committedTotal: 0,
      available: 0,
      spentRatio: 0,
      categories: [],
    },
    items: [],
    limits: [],
  }
  if (!process.env.DATABASE_URL || !userId || !MONTH_RE.test(month))
    return empty

  const [view, budgetRow, accounts, catalog] = await Promise.all([
    getBudgetView(userId, month),
    prisma.budget.findUnique({
      where: { userId_month: { userId, month } },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.account.findMany({
      where: { userId, isActive: true, isHidden: false },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    getCatalog(userId),
  ])

  const accName = new Map(accounts.map((a) => [a.id, a.name]))
  const items: BudgetItemRow[] = (budgetRow?.items ?? []).map((i) => ({
    id: i.id,
    label: i.label,
    amount: normalizeMoney(i.amount),
    accountId: i.accountId,
    accountName: i.accountId ? (accName.get(i.accountId) ?? null) : null,
  }))

  const catByCode = new Map(catalog.map((c) => [c.code, c]))
  const limits: BudgetLimitRow[] = view.categories
    .filter((c) => c.limit != null)
    .map((c) => ({
      category: c.category,
      label: catByCode.get(c.category)?.name ?? c.category,
      color: catByCode.get(c.category)?.color ?? '#71717a',
      limit: c.limit as number,
      used: c.used,
    }))

  return { view, items, limits }
}

// Derivación del view-model de Presupuestos desde filas Dexie (solo lectura).
//
// Réplica en cliente lo que `getBudgetView` + `getBudgetPageData`
// (`lib/budgets.ts`) calculan en el servidor para un mes "YYYY-MM":
// comprometido automático (MSI del mes + suscripciones esperadas +
// liquidación de pareja) + manual (ingreso base, fijos, límites).
// Puro y sin Prisma: opera sobre arrays. Las mutaciones siguen online.
//
// NOTA: no importar valores de `@/lib/budgets` (trae Prisma al bundle);
// solo tipos. El regex de mes se duplica a propósito.
import { installmentMonths, monthlyTotal, settleMonth } from '@/lib/calculations'
import { fromCents, toCents } from '@/lib/money'
import type {
  OfflineAccount,
  OfflineBudget,
  OfflineBudgetItem,
  OfflineBudgetLimit,
  OfflineCategory,
  OfflineCharge,
  OfflineLineSum,
  OfflinePartnerShared,
  OfflineShare,
  OfflineSubscription,
  OfflineTransaction,
} from '@/lib/offline/db'
import { monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey } from '@/lib/walltime'
import type {
  BudgetItemRow,
  BudgetLimitRow,
  BudgetPageData,
  BudgetView,
} from '@/lib/budgets'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export type BudgetMonthOpt = { key: string; label: string }

export type BudgetLocalCtx = {
  userId: string
  month: string
  accounts: OfflineAccount[]
  transactions: OfflineTransaction[]
  shares: OfflineShare[]
  lineSums: OfflineLineSum[]
  subscriptions: OfflineSubscription[]
  charges: OfflineCharge[]
  categories: OfflineCategory[]
  partnerShared: OfflinePartnerShared[]
  budgets: OfflineBudget[]
  budgetItems: OfflineBudgetItem[]
  budgetLimits: OfflineBudgetLimit[]
}

/** Tablas locales que el shell pasa al cliente (el mes lo pone el cliente). */
export type BudgetLocalSnapshot = Omit<BudgetLocalCtx, 'month'>

function emptyView(month: string): BudgetView {
  return {
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
}

function emptyPage(month: string): BudgetPageData {
  return { view: emptyView(month), items: [], limits: [] }
}

/** Mismo rango que `monthRange` del servidor (mes calendario local). */
function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 0, 23, 59, 59, 999),
  }
}

/**
 * Vista completa del presupuesto del mes desde la copia local.
 * Misma semántica que `getBudgetView`: el settle de pareja usa mes
 * calendario (el servidor no incluye la cuenta/corte en esa consulta).
 */
export function deriveBudgetPageData(ctx: BudgetLocalCtx): BudgetPageData {
  const { userId, month } = ctx
  if (!userId || !MONTH_RE.test(month)) return emptyPage(month)

  const { start, end } = monthBounds(month)
  // Ventana amplia para no perder MSI largos en parcialidades del mes.
  const lookback = new Date(start.getFullYear(), start.getMonth() - 24, 1)

  // — Manual del mes (ingreso base, fijos, límites) —
  const budget = ctx.budgets.find((b) => b.month === month)
  const baseIncome = budget?.baseIncome ?? 0
  const manualItems = ctx.budgetItems
    .filter((i) => i.month === month)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const manualLimits = ctx.budgetLimits.filter((l) => l.month === month)

  // Solo cuentas visibles (el snapshot ya trae solo activas).
  const accounts = ctx.accounts.filter((a) => !a.isHidden)

  // — Mis EXPENSE en ventana (incluye grupales: suman a categoría aunque
  // no comprometan tarjeta) —
  const inWindow = (iso: string) => {
    const d = new Date(iso)
    return d >= lookback && d <= end
  }
  const myTxs = ctx.transactions.filter(
    (t) =>
      t.createdById === userId && t.type === 'EXPENSE' && inWindow(t.date),
  )

  // — Involucrados para el settle: mis compartidos + compras de mi pareja —
  const sharesByTx = new Map<string, OfflineShare[]>()
  for (const s of ctx.shares) {
    if (s.debtorId == null) continue
    const arr = sharesByTx.get(s.transactionId) ?? []
    arr.push(s)
    sharesByTx.set(s.transactionId, arr)
  }
  const involved = [
    ...ctx.transactions
      .filter(
        (t) =>
          !t.partnerShare &&
          t.type === 'EXPENSE' &&
          t.isShared &&
          t.createdById === userId &&
          inWindow(t.date),
      )
      .map((t) => ({
        id: t.id,
        concept: t.concept,
        amount: t.amount,
        installments: t.installments,
        date: new Date(t.date),
        isShared: t.isShared,
        createdById: t.createdById,
        creatorName: t.creatorName,
        shares: (sharesByTx.get(t.id) ?? []).map((s) => ({
          id: s.id,
          debtorId: s.debtorId as string,
          debtorName: s.debtorName,
          sharePct: s.sharePct,
          monthlyAmount: s.monthlyAmount,
        })),
      })),
    ...ctx.partnerShared
      .filter((p) => inWindow(p.date))
      .map((p) => ({
        id: p.id,
        concept: p.concept,
        amount: p.amount,
        installments: p.installments,
        date: new Date(p.date),
        isShared: true,
        createdById: p.createdById,
        creatorName: p.creatorName,
        shares: (sharesByTx.get(p.id) ?? []).map((s) => ({
          id: s.id,
          debtorId: s.debtorId as string,
          debtorName: s.debtorName,
          sharePct: s.sharePct,
          monthlyAmount: s.monthlyAmount,
        })),
      })),
  ]
  const confirmed = new Map(
    ctx.lineSums.map((s) => [s.key, s.confirmed] as const),
  )
  const settlement = settleMonth(involved, month, confirmed)
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

  // — Comprometido automático por cuenta + usado por categoría —
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
    const months = installmentMonths(new Date(t.date), t.installments)
    const idx = months.indexOf(month)
    if (idx === -1) continue
    const sliceC = toCents(monthlyTotal(t.amount, t.installments))
    if (sliceC <= 0) continue
    // Sin cuenta (gasto grupal aún sin atribuir): no compromete tarjeta;
    // igual cuenta para el usado por categoría.
    if (t.accountId)
      pushAuto(
        t.accountId,
        t.installments > 1
          ? `${t.concept} (${idx + 1}/${t.installments} MSI)`
          : t.concept,
        sliceC,
      )
    pushCat(t.category, sliceC)
  }

  // Suscripciones propias esperadas sin confirmar.
  const chargedBySub = new Map(
    ctx.charges
      .filter((c) => c.month === month)
      .map((c) => [
        c.subscriptionId,
        { skipped: c.skipped, hasTx: c.transactionId != null },
      ]),
  )
  for (const s of ctx.subscriptions) {
    if (!s.isMine || !s.isActive || s.startMonth > month) continue
    const row = chargedBySub.get(s.id)
    if (row && (row.skipped || row.hasTx)) continue
    const amtC = toCents(s.amount)
    if (amtC <= 0) continue
    pushAuto(s.accountId, `${s.name} (suscripción esperada)`, amtC)
    pushCat(s.category, amtC)
  }

  // — Fijos manuales: por cuenta o generales —
  const manualByAccC = new Map<string, number>()
  let manualGeneralC = 0
  const manualGeneralDetails: { label: string; amount: number }[] = []
  for (const it of manualItems) {
    const c = toCents(it.amount)
    if (c <= 0) continue
    if (it.accountId) {
      manualByAccC.set(it.accountId, (manualByAccC.get(it.accountId) ?? 0) + c)
    } else {
      manualGeneralC += c
      manualGeneralDetails.push({ label: it.label, amount: fromCents(c) })
    }
  }

  const accountLines = accounts.map((a) => {
    const aC = autoC.get(a.id) ?? 0
    const mC = manualByAccC.get(a.id) ?? 0
    const details = [...(autoDetails.get(a.id) ?? [])]
    for (const it of manualItems) {
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

  const limitByCat = new Map(manualLimits.map((l) => [l.category, l.limit]))
  const categories = [...new Set([...catUsedC.keys(), ...limitByCat.keys()])]
    .map((category) => ({
      category,
      limit: limitByCat.get(category) ?? null,
      used: fromCents(catUsedC.get(category) ?? 0),
    }))
    .sort((a, b) => b.used - a.used)

  const incomeC = toCents(baseIncome)
  const accountsC = accountLines.reduce((a, l) => a + toCents(l.total), 0)
  const committedC = accountsC + manualGeneralC + owedC
  const availableC = incomeC - committedC

  const view: BudgetView = {
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

  // — Filas para la UI (igual que `getBudgetPageData`) —
  const accName = new Map(accounts.map((a) => [a.id, a.name]))
  const items: BudgetItemRow[] = manualItems.map((i) => ({
    id: i.id,
    label: i.label,
    amount: i.amount,
    accountId: i.accountId,
    accountName: i.accountId ? (accName.get(i.accountId) ?? null) : null,
  }))

  const catByCode = new Map(ctx.categories.map((c) => [c.code, c]))
  const limits: BudgetLimitRow[] = categories
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

const PAST = 6
const FUTURE = 6

/**
 * Selector de meses: 6 pasados + actual + 6 futuros (planificación) +
 * cualquiera con presupuesto guardado. Igual que la página del servidor.
 */
export function deriveBudgetMonths(budgetMonths: string[]): BudgetMonthOpt[] {
  const current = mexicoMonthKey()
  const keys = new Set<string>([current, ...budgetMonths])
  const [cy, cm] = current.split('-').map(Number)
  for (let i = PAST; i >= 1; i--) {
    const d = new Date(Date.UTC(cy, cm - 1 - i, 1))
    keys.add(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    )
  }
  for (let i = 1; i <= FUTURE; i++) {
    const d = new Date(Date.UTC(cy, cm - 1 + i, 1))
    keys.add(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    )
  }
  return [...keys]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((k) => {
      const [y, m] = k.split('-').map(Number)
      return { key: k, label: monthLabelEs(new Date(y, m - 1, 1)) }
    })
}

/** Cuentas visibles para el selector de fijos (solo id + nombre). */
export function toBudgetAccountOpts(
  accounts: OfflineAccount[],
): { id: string; name: string }[] {
  return accounts.filter((a) => !a.isHidden).map((a) => ({ id: a.id, name: a.name }))
}

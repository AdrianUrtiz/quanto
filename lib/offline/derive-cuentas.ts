// Derivación del view-model de Cuentas desde filas Dexie (Etapa 4).
//
// Réplica en cliente la forma que `app/(app)/cuentas/page.tsx` le pasa a
// `CuentasClient`. Puro y sin Prisma: opera sobre arrays.
import type { AccountRow } from '@/components/account-card'
import type { MonthOpt } from '@/components/activity-client'
import type {
  MyPendingItem,
  SourceConfirmItem,
  ToConfirmItem,
} from '@/components/cuentas-client'
import type { SubRow } from '@/components/subscription-tab'

import { payableInstallments } from '@/lib/calculations'
import type { LineSums } from '@/lib/debt-payments'
import type {
  OfflineAccount,
  OfflineCharge,
  OfflineDebtPayment,
  OfflineLineSum,
  OfflinePartnerDebt,
  OfflinePartnerShared,
  OfflineShare,
  OfflineSubscription,
} from '@/lib/offline/db'
import { toCardPayItems, toCatalog } from '@/lib/offline/derive-activity'
import { type DebtItemInput, buildDebts } from '@/lib/partner-debts'
import type { DueCharge, SubInfo } from '@/lib/subscriptions'
import { computeDues, monthHistory } from '@/lib/subscriptions'
import type { ChargeRow } from '@/lib/subscriptions'
import { monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey } from '@/lib/walltime'

export { toCardPayItems, toCatalog }

/** Visibles y ocultas (las ocultas solo viven en su tab). */
export function toAccountRows(accounts: OfflineAccount[]): {
  visible: AccountRow[]
  hidden: AccountRow[]
} {
  const map = (a: OfflineAccount): AccountRow => ({
    id: a.id,
    name: a.name,
    type: a.type,
    owner: a.owner,
    ownerId: a.ownerId,
    balance: a.balance,
    creditLimit: a.creditLimit,
    statementDay: a.statementDay,
    dueDay: a.dueDay,
    lastFour: a.lastFour,
    expiry: a.expiry,
    color: a.color,
    isHidden: a.isHidden,
  })
  return {
    visible: accounts.filter((a) => !a.isHidden).map(map),
    hidden: accounts.filter((a) => a.isHidden).map(map),
  }
}

function toDebtInput(d: OfflinePartnerDebt): DebtItemInput {
  return {
    shareId: d.shareId,
    accountId: d.accountId,
    accountName: d.accountName,
    accountType: d.accountType,
    dueDay: d.dueDay ?? undefined,
    debtorId: d.debtorId,
    debtorName: d.debtorName,
    creditorName: d.creditorName,
    concept: d.concept,
    monthly: d.monthly,
    installments: d.installments,
    date: d.date,
    statementDay: d.statementDay ?? undefined,
  }
}

/** Lo que debo (owe) y lo que me deben (owed). */
export function toDebtItems(rows: OfflinePartnerDebt[]): {
  debtItems: DebtItemInput[]
  owedItems: DebtItemInput[]
} {
  return {
    debtItems: rows.filter((d) => d.direction === 'owe').map(toDebtInput),
    owedItems: rows.filter((d) => d.direction === 'owed').map(toDebtInput),
  }
}

export function toSums(rows: OfflineLineSum[]): {
  list: { key: string; confirmed: number; pending: number }[]
  map: Map<string, LineSums>
} {
  return {
    list: rows.map((s) => ({
      key: s.key,
      confirmed: s.confirmed,
      pending: s.pending,
    })),
    map: new Map(
      rows.map((s) => [s.key, { confirmed: s.confirmed, pending: s.pending }]),
    ),
  }
}

/** Meses con parcialidades exigibles (debo + me deben), igual que el servidor. */
export function derivePartnerMonths(
  debtItems: DebtItemInput[],
  owedItems: DebtItemInput[],
  sums: Map<string, LineSums>,
  currentMonth = mexicoMonthKey(),
): MonthOpt[] {
  const monthKeys = new Set<string>([currentMonth])
  for (const it of [...debtItems, ...owedItems])
    for (const p of payableInstallments(
      new Date(it.date),
      it.installments,
      it.statementDay,
      it.dueDay,
    ))
      monthKeys.add(p.dueKey)
  return [...monthKeys]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((k) => {
      const [y, mo] = k.split('-').map(Number)
      const total =
        buildDebts(debtItems, k, sums).reduce((a, d) => a + d.remaining, 0) +
        buildDebts(owedItems, k, sums).reduce((a, d) => a + d.remaining, 0)
      return { key: k, label: monthLabelEs(new Date(y, mo - 1, 1)), total }
    })
}

function toSubInfos(rows: OfflineSubscription[], meId: string): SubInfo[] {
  return rows.map((s) => ({
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
    ownerId: s.isMine ? meId : '',
    ownerName: s.ownerName,
    isMine: s.isMine,
    partnerName: s.partnerName,
  }))
}

function toChargeMap(rows: OfflineCharge[]): Map<string, ChargeRow> {
  return new Map(
    rows.map((c) => [
      `${c.subscriptionId}:${c.month}`,
      {
        subscriptionId: c.subscriptionId,
        month: c.month,
        transactionId: c.transactionId,
        skipped: c.skipped,
        ownerPaid: c.ownerPaid,
        partnerPaid: c.partnerPaid,
        ownerPaidByName: c.ownerPaidByName,
        partnerPaidByName: c.partnerPaidByName,
      },
    ]),
  )
}

/** Plantillas con historial + cargos pendientes (checklist mensual). */
export function toSubs(
  subscriptions: OfflineSubscription[],
  charges: OfflineCharge[],
  meId: string,
): { subs: SubRow[]; dues: DueCharge[] } {
  const infos = toSubInfos(subscriptions, meId)
  const chargeMap = toChargeMap(charges)
  return {
    subs: infos.map((s) => ({ ...s, history: monthHistory(s, chargeMap) })),
    dues: computeDues(infos, chargeMap),
  }
}

function monthLabelOf(month: string): string {
  const [y, mo] = month.split('-').map(Number)
  return monthLabelEs(new Date(y, mo - 1, 1))
}

/** Pagos que mi pareja registró y yo debo confirmar (soy el acreedor). */
export function toToConfirm(
  rows: OfflineDebtPayment[],
  meId: string,
): ToConfirmItem[] {
  return rows
    .filter((p) => p.status === 'PENDING' && p.registeredById !== meId)
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      month: p.month,
      monthLabel: p.monthLabel || monthLabelOf(p.month),
      concept: p.concept,
      monthly: p.monthly,
      shareId: p.shareId,
      registeredByName: p.registeredByName,
    }))
}

/** Pagos que yo registré y esperan confirmación de mi pareja. */
export function toMyPending(
  rows: OfflineDebtPayment[],
  shares: OfflineShare[],
  partnerShared: OfflinePartnerShared[],
  meId: string,
): MyPendingItem[] {
  const creatorByTx = new Map(partnerShared.map((p) => [p.id, p.creatorName]))
  const txByShare = new Map(shares.map((s) => [s.id, s.transactionId]))
  return rows
    .filter((p) => p.status === 'PENDING' && p.registeredById === meId)
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      month: p.month,
      monthLabel: p.monthLabel || monthLabelOf(p.month),
      concept: p.concept,
      monthly: p.monthly,
      shareId: p.shareId,
      confirmerName: creatorByTx.get(txByShare.get(p.shareId) ?? '') ?? '',
    }))
}

/** Cobros que el acreedor dice recibidos y esperan mi cuenta origen. */
export function toToConfirmSource(
  rows: OfflineDebtPayment[],
): SourceConfirmItem[] {
  return rows
    .filter((p) => p.status === 'CONFIRMED')
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      month: p.month,
      monthLabel: p.monthLabel || monthLabelOf(p.month),
      concept: p.concept,
      creditorName: p.registeredByName,
    }))
}

// Derivación del view-model de Actividad desde filas Dexie (Etapa 2).
//
// Réplica en cliente la forma que `app/(app)/actividad/page.tsx` le pasa a
// `ActivityClient` + banners. Puro y sin Prisma: opera sobre arrays.
import type { MonthOpt } from '@/components/activity-client'
import type {
  SourceConfirmItem,
  ToConfirmItem,
} from '@/components/cuentas-client'
import type { ExpiryAccount } from '@/components/expiry-reminders'
import type { TxRow } from '@/components/transaction-list'

import type { CardPayCandidate } from '@/lib/card-pay'
import type { CatalogRow } from '@/lib/catalog'
import type { CatKind } from '@/lib/categories'
import type {
  OfflineAccount,
  OfflineCategory,
  OfflineDebtPayment,
  OfflineLineSum,
  OfflinePartnerDebt,
  OfflineTransaction,
} from '@/lib/offline/db'
import type { PartnerPayItem } from '@/lib/partner-pay'
import { isPendingId } from '@/lib/offline/pending'
import { monthKey, monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey } from '@/lib/walltime'

export function toTxRows(rows: OfflineTransaction[]): TxRow[] {
  return rows.map((t) => ({
    id: t.id,
    concept: t.concept,
    category: t.category,
    amount: t.amount,
    date: t.date,
    type: t.type,
    accountId: t.accountId,
    accountName: t.accountName,
    accountType: t.accountType,
    transferToAccountId: t.transferToAccountId ?? null,
    transferToAccountName: t.transferToAccountName ?? null,
    transferToAccountType: t.transferToAccountType ?? null,
    creatorName: t.creatorName,
    installments: t.installments,
    isShared: t.isShared,
    partnerShare: t.partnerShare ?? false,
    locked: t.locked ?? false,
    pendingSync: isPendingId(t.id),
  }))
}

/** Meses con registro (solo gastos suman), igual que el servidor. */
export function deriveMonths(rows: OfflineTransaction[]): MonthOpt[] {
  const totals = new Map<string, number>()
  for (const t of rows) {
    if (t.type !== 'EXPENSE') continue
    const k = monthKey(new Date(t.date))
    totals.set(k, (totals.get(k) ?? 0) + t.amount)
  }
  const current = mexicoMonthKey()
  if (!totals.has(current)) totals.set(current, 0)
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, total]) => {
      const [y, m] = key.split('-').map(Number)
      return { key, label: monthLabelEs(new Date(y, m - 1, 1)), total }
    })
}

export function toCatalog(rows: OfflineCategory[]): CatalogRow[] {
  return rows.map((c) => ({
    id: c.code,
    code: c.code,
    name: c.name,
    iconName: c.iconName,
    color: c.color,
    kind: c.kind as CatKind,
    isDefault: c.isDefault,
    mine: c.mine,
  }))
}

/** Cuentas visibles (no ocultas) para filtros y banners. */
export function toAccountOptions(
  rows: OfflineAccount[],
): {
  id: string
  name: string
  type: string
  color: string
  isFavorite: boolean
}[] {
  return rows
    .filter((a) => !a.isHidden)
    .sort(
      (x, y) =>
        Number(y.isFavorite) - Number(x.isFavorite) || x.position - y.position,
    )
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      color: a.color,
      isFavorite: a.isFavorite,
    }))
}

export function toExpiryAccounts(rows: OfflineAccount[]): ExpiryAccount[] {
  return rows
    .filter((a) => !a.isHidden)
    .map((a) => ({
      id: a.id,
      name: a.name,
      lastFour: a.lastFour ?? null,
      expiry: a.expiry ?? null,
      color: a.color,
    }))
}

/** Lo que le debo a mi pareja (origen Cuentas > Pareja). */
export function toPartnerPayItems(
  rows: OfflinePartnerDebt[],
): PartnerPayItem[] {
  return rows
    .filter((d) => d.direction === 'owe' && d.shareId)
    .map((d) => ({
      shareId: d.shareId,
      accountId: d.accountId,
      accountName: d.accountName,
      accountType: d.accountType,
      dueDay: d.dueDay,
      statementDay: d.statementDay,
      creditorName: d.creditorName,
      concept: d.concept,
      monthly: d.monthly,
      installments: d.installments,
      date: d.date,
    }))
}

export function toPartnerSums(
  rows: OfflineLineSum[],
): { key: string; confirmed: number; pending: number }[] {
  return rows.map((s) => ({
    key: s.key,
    confirmed: s.confirmed,
    pending: s.pending,
  }))
}

/** Pagos que mi pareja registró y yo debo confirmar (soy el acreedor). */
export function toToConfirm(
  rows: OfflineDebtPayment[],
  meId: string,
): ToConfirmItem[] {
  return rows
    .filter(
      (p) => p.status === 'PENDING' && p.registeredById !== meId && p.shareId,
    )
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      month: p.month,
      monthLabel: p.monthLabel,
      concept: p.concept,
      monthly: p.monthly,
      shareId: p.shareId,
      registeredByName: p.registeredByName,
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
      monthLabel: p.monthLabel,
      concept: p.concept,
      creditorName: p.registeredByName,
    }))
}

export function toCardPayItems(rows: CardPayCandidate[]): CardPayCandidate[] {
  return rows
}

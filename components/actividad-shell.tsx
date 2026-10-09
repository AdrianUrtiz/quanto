'use client'

import { useLiveQuery } from 'dexie-react-hooks'

import { ActivityClient, type MonthOpt } from '@/components/activity-client'
import type {
  SourceConfirmItem,
  ToConfirmItem,
} from '@/components/cuentas-client'
import type { ExpiryAccount } from '@/components/expiry-reminders'
import { PendingOutboxBanner } from '@/components/pending-outbox-banner'
import { PendingPaymentsBanner } from '@/components/pending-payments-banner'
import { SourceConfirmBanner } from '@/components/source-confirm-banner'
import type { TxRow } from '@/components/transaction-list'

import type { CardPayCandidate } from '@/lib/card-pay'
import type { CatalogRow } from '@/lib/catalog'
import { db } from '@/lib/offline/db'
import {
  deriveMonths,
  toAccountOptions,
  toCardPayItems,
  toCatalog,
  toExpiryAccounts,
  toPartnerPayItems,
  toPartnerSums,
  toToConfirm,
  toToConfirmSource,
  toTxRows,
} from '@/lib/offline/derive-activity'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { useSnapshotSync } from '@/lib/offline/useSnapshotSync'
import type { PartnerPayItem } from '@/lib/partner-pay'

type Props = {
  txs: TxRow[]
  months: MonthOpt[]
  cats: CatalogRow[]
  filterAccounts: {
    id: string
    name: string
    type: string
    color?: string
    isFavorite?: boolean
  }[]
  expiryAccounts: ExpiryAccount[]
  partnerDebtItems: PartnerPayItem[]
  partnerSums: { key: string; confirmed: number; pending: number }[]
  cardPayItems: CardPayCandidate[]
  toConfirm: ToConfirmItem[]
  toConfirmSource: SourceConfirmItem[]
}

/**
 * Hidratación Dexie-first de Actividad: si hay copia local (online u
 * offline) se deriva el view-model desde IndexedDB y pinta al instante;
 * los props del servidor solo son fallback de primera carga. La revalidación
 * (`/api/snapshot` si la copia está vieja) corre en background sin bloquear.
 */
export function ActividadShell(server: Props) {
  const online = useOnlineStatus()
  const { isRevalidating } = useSnapshotSync()
  const local = useLiveQuery(async () => {
    const [
      meta,
      transactions,
      accounts,
      categories,
      debtPayments,
      lineSums,
      partnerDebts,
      cardPay,
    ] = await Promise.all([
      db.meta.get('sync'),
      db.transactions.toArray(),
      db.accounts.toArray(),
      db.categories.toArray(),
      db.debtPayments.toArray(),
      db.lineSums.toArray(),
      db.partnerDebts.toArray(),
      db.cardPay.toArray(),
    ])
    return {
      meta,
      transactions,
      accounts,
      categories,
      debtPayments,
      lineSums,
      partnerDebts,
      cardPay,
    }
  }, [])

  const hasLocal =
    !!local && (local.transactions.length > 0 || local.accounts.length > 0)
  // Dexie-first: con copia local se usa siempre (online u offline).
  // Sin copia, se cae al fallback del servidor (primera carga).
  const useLocal = hasLocal

  const view: Props = useLocal
    ? {
        txs: toTxRows(
          [...local.transactions].sort((a, b) => b.date.localeCompare(a.date)),
        ),
        months: deriveMonths(local.transactions),
        cats: toCatalog(local.categories),
        filterAccounts: toAccountOptions(local.accounts),
        expiryAccounts: toExpiryAccounts(local.accounts),
        partnerDebtItems: toPartnerPayItems(local.partnerDebts),
        partnerSums: toPartnerSums(local.lineSums),
        cardPayItems: toCardPayItems(local.cardPay),
        toConfirm: toToConfirm(local.debtPayments, local.meta?.userId ?? ''),
        toConfirmSource: toToConfirmSource(local.debtPayments),
      }
    : server

  // Sin red y sin copia local: no hay nada que hidratar.
  if (!online && !hasLocal) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-20 text-center">
        <p className="text-lg font-bold">Sin conexión</p>
        <p className="text-sm text-(--muted-foreground)">
          Conéctate una vez para descargar tus datos y ver tu actividad sin
          internet.
        </p>
      </div>
    )
  }

  const lastSync = local?.meta?.lastSyncAt
    ? new Date(local.meta.lastSyncAt).toLocaleString('es-MX', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <>
      {!online && lastSync && (
        <p className="px-5 pt-3 text-center text-xs font-medium text-amber-500">
          Sin conexión · datos del {lastSync}
        </p>
      )}
      {online && useLocal && isRevalidating && (
        <p
          role="status"
          className="px-5 pt-3 text-center text-xs font-medium text-(--muted-foreground)">
          Actualizando…
        </p>
      )}
      <PendingOutboxBanner />
      <PendingPaymentsBanner
        items={view.toConfirm}
        accountOptions={view.filterAccounts}
      />
      <SourceConfirmBanner
        items={view.toConfirmSource}
        accountOptions={view.filterAccounts}
      />
      <ActivityClient
        txs={view.txs}
        months={view.months}
        cats={view.cats}
        filterAccounts={view.filterAccounts}
        expiryAccounts={view.expiryAccounts}
        partnerDebtItems={view.partnerDebtItems}
        partnerSums={view.partnerSums}
        cardPayItems={view.cardPayItems}
      />
    </>
  )
}

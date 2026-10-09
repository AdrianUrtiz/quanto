'use client'

import { useLiveQuery } from 'dexie-react-hooks'

import type { AccountRow } from '@/components/account-card'
import type { MonthOpt } from '@/components/activity-client'
import {
  CuentasClient,
  type MyPendingItem,
  type SourceConfirmItem,
  type ToConfirmItem,
} from '@/components/cuentas-client'
import { PendingOutboxBanner } from '@/components/pending-outbox-banner'
import type { SubRow } from '@/components/subscription-tab'

import type { CardPayCandidate } from '@/lib/card-pay'
import type { CatalogRow } from '@/lib/catalog'
import { db } from '@/lib/offline/db'
import {
  derivePartnerMonths,
  toAccountRows,
  toCardPayItems,
  toCatalog,
  toDebtItems,
  toEchoOwedItems,
  toMyPending,
  toSubs,
  toSums,
  toToConfirm,
  toToConfirmSource,
} from '@/lib/offline/derive-cuentas'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { useSnapshotSync } from '@/lib/offline/useSnapshotSync'
import type { DebtItemInput } from '@/lib/partner-debts'
import type { DueCharge } from '@/lib/subscriptions'

type Props = {
  accounts: AccountRow[]
  hiddenAccounts: AccountRow[]
  meId: string
  editAccountId: string | null
  debtItems: DebtItemInput[]
  owedItems: DebtItemInput[]
  sums: { key: string; confirmed: number; pending: number }[]
  partnerMonths: MonthOpt[]
  subs: SubRow[]
  dues: DueCharge[]
  cats: CatalogRow[]
  toConfirm: ToConfirmItem[]
  myPending: MyPendingItem[]
  toConfirmSource: SourceConfirmItem[]
  cardPayItems: CardPayCandidate[]
}

/**
 * Hidratación Dexie-first de Cuentas: si hay copia local (online u offline)
 * se deriva el view-model desde IndexedDB y pinta al instante; los props
 * del servidor solo son fallback de primera carga. La revalidación corre
 * en background sin bloquear.
 */
export function CuentasShell(server: Props) {
  const online = useOnlineStatus()
  const { isRevalidating } = useSnapshotSync()
  const local = useLiveQuery(async () => {
    const [
      meta,
      accounts,
      transactions,
      partnerDebts,
      lineSums,
      subscriptions,
      charges,
      categories,
      debtPayments,
      shares,
      partnerShared,
      cardPay,
    ] = await Promise.all([
      db.meta.get('sync'),
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.partnerDebts.toArray(),
      db.lineSums.toArray(),
      db.subscriptions.toArray(),
      db.charges.toArray(),
      db.categories.toArray(),
      db.debtPayments.toArray(),
      db.shares.toArray(),
      db.partnerShared.toArray(),
      db.cardPay.toArray(),
    ])
    return {
      meta,
      accounts,
      transactions,
      partnerDebts,
      lineSums,
      subscriptions,
      charges,
      categories,
      debtPayments,
      shares,
      partnerShared,
      cardPay,
    }
  }, [])

  const hasLocal =
    !!local && (local.accounts.length > 0 || local.subscriptions.length > 0)
  // Dexie-first: con copia local se usa siempre (online u offline).
  const useLocal = hasLocal
  const meId = useLocal ? (local.meta?.userId ?? server.meId) : server.meId

  const view: Props = useLocal
    ?       (() => {
        const { visible, hidden } = toAccountRows(local.accounts)
        const { debtItems, owedItems } = toDebtItems(local.partnerDebts)
        // Ecos offline de mis compartidos: pintan igual (con badge) aunque
        // aún no estén en `partnerDebts` del snapshot.
        const owed = [
          ...owedItems,
          ...toEchoOwedItems(
            local.transactions,
            local.accounts,
            local.shares,
            meId,
          ),
        ]
        const sums = toSums(local.lineSums)
        const { subs, dues } = toSubs(local.subscriptions, local.charges, meId)
        return {
          accounts: visible,
          hiddenAccounts: hidden,
          meId,
          editAccountId: server.editAccountId,
          debtItems,
          owedItems: owed,
          sums: sums.list,
          partnerMonths: derivePartnerMonths(debtItems, owed, sums.map),
          subs,
          dues,
          cats: toCatalog(local.categories),
          toConfirm: toToConfirm(local.debtPayments, meId),
          myPending: toMyPending(
            local.debtPayments,
            local.shares,
            local.partnerShared,
            meId,
          ),
          toConfirmSource: toToConfirmSource(local.debtPayments),
          cardPayItems: toCardPayItems(local.cardPay),
        }
      })()
    : server

  if (!online && !hasLocal) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-20 text-center">
        <p className="text-lg font-bold">Sin conexión</p>
        <p className="text-sm text-(--muted-foreground)">
          Conéctate una vez para descargar tus datos y ver tus cuentas sin
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
      <CuentasClient
        accounts={view.accounts}
        hiddenAccounts={view.hiddenAccounts}
        meId={view.meId}
        editAccountId={view.editAccountId}
        debtItems={view.debtItems}
        owedItems={view.owedItems}
        sums={view.sums}
        partnerMonths={view.partnerMonths}
        subs={view.subs}
        dues={view.dues}
        cats={view.cats}
        toConfirm={view.toConfirm}
        myPending={view.myPending}
        toConfirmSource={view.toConfirmSource}
        cardPayItems={view.cardPayItems}
      />
    </>
  )
}

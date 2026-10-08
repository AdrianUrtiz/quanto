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
  toMyPending,
  toSubs,
  toSums,
  toToConfirm,
  toToConfirmSource,
} from '@/lib/offline/derive-cuentas'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
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
 * Hidratación offline de Cuentas: en línea renderiza los props del servidor
 * tal cual; sin conexión deriva el mismo view-model desde IndexedDB
 * (cuentas, pareja, suscripciones) vía `useLiveQuery`.
 */
export function CuentasShell(server: Props) {
  const online = useOnlineStatus()
  const local = useLiveQuery(async () => {
    const [
      meta,
      accounts,
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
  const useLocal = !online && hasLocal
  const meId = useLocal ? (local.meta?.userId ?? server.meId) : server.meId

  const view: Props = useLocal
    ? (() => {
        const { visible, hidden } = toAccountRows(local.accounts)
        const { debtItems, owedItems } = toDebtItems(local.partnerDebts)
        const sums = toSums(local.lineSums)
        const { subs, dues } = toSubs(local.subscriptions, local.charges, meId)
        return {
          accounts: visible,
          hiddenAccounts: hidden,
          meId,
          editAccountId: server.editAccountId,
          debtItems,
          owedItems,
          sums: sums.list,
          partnerMonths: derivePartnerMonths(debtItems, owedItems, sums.map),
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

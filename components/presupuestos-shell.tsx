'use client'

import { useLiveQuery } from 'dexie-react-hooks'

import { PresupuestosClient } from '@/components/presupuestos-client'

import type { BudgetPageData } from '@/lib/budgets'
import { db } from '@/lib/offline/db'
import { toCatalog } from '@/lib/offline/derive-activity'
import {
  type BudgetLocalSnapshot,
  deriveBudgetMonths,
  toBudgetAccountOpts,
} from '@/lib/offline/derive-presupuestos'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { useSnapshotSync } from '@/lib/offline/useSnapshotSync'

type MonthOpt = { key: string; label: string }
type CatOpt = {
  code: string
  name: string
  iconName: string
  color: string
  kind: 'expense' | 'income' | 'both'
}

type Props = {
  initialMonth: string
  initialData: BudgetPageData
  months: MonthOpt[]
  cats: CatOpt[]
  accountOpts: { id: string; name: string }[]
}

/**
 * Hidratación Dexie-first de Presupuestos (solo lectura offline).
 *
 * Con copia local se resuelven meses/categorías/cuentas desde IndexedDB y
 * el cliente deriva la vista del mes seleccionado sin llamar al servidor;
 * los props del servidor solo son fallback de primera carga. Las mutaciones
 * siguen siendo online (el cliente las bloquea sin red). La revalidación
 * corre en background sin bloquear.
 */
export function PresupuestosShell(server: Props) {
  const online = useOnlineStatus()
  const { isRevalidating } = useSnapshotSync()
  const local = useLiveQuery(async () => {
    const [
      meta,
      accounts,
      transactions,
      shares,
      lineSums,
      subscriptions,
      charges,
      categories,
      partnerShared,
      budgets,
      budgetItems,
      budgetLimits,
    ] = await Promise.all([
      db.meta.get('sync'),
      db.accounts.toArray(),
      db.transactions.toArray(),
      db.shares.toArray(),
      db.lineSums.toArray(),
      db.subscriptions.toArray(),
      db.charges.toArray(),
      db.categories.toArray(),
      db.partnerShared.toArray(),
      db.budgets.toArray(),
      db.budgetItems.toArray(),
      db.budgetLimits.toArray(),
    ])
    return {
      meta,
      accounts,
      transactions,
      shares,
      lineSums,
      subscriptions,
      charges,
      categories,
      partnerShared,
      budgets,
      budgetItems,
      budgetLimits,
    }
  }, [])

  const userId = local?.meta?.userId ?? ''
  const hasLocal =
    !!local &&
    !!userId &&
    (local.transactions.length > 0 || local.accounts.length > 0)
  // Dexie-first: con copia local se usa siempre (online u offline).
  const useLocal = hasLocal

  const snapshot: BudgetLocalSnapshot | null = useLocal
    ? {
        userId,
        accounts: local.accounts,
        transactions: local.transactions,
        shares: local.shares,
        lineSums: local.lineSums,
        subscriptions: local.subscriptions,
        charges: local.charges,
        categories: local.categories,
        partnerShared: local.partnerShared,
        budgets: local.budgets,
        budgetItems: local.budgetItems,
        budgetLimits: local.budgetLimits,
      }
    : null

  const view: Props & { local: BudgetLocalSnapshot | null } = useLocal
    ? {
        initialMonth: server.initialMonth,
        initialData: server.initialData,
        months: deriveBudgetMonths(local.budgets.map((b) => b.month)),
        cats: toCatalog(local.categories).map((c) => ({
          code: c.code,
          name: c.name,
          iconName: c.iconName,
          color: c.color,
          kind: c.kind,
        })),
        accountOpts: toBudgetAccountOpts(local.accounts),
        local: snapshot,
      }
    : { ...server, local: null }

  if (!online && !hasLocal) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-20 text-center">
        <p className="text-lg font-bold">Sin conexión</p>
        <p className="text-sm text-(--muted-foreground)">
          Conéctate una vez para descargar tus datos y ver tus presupuestos sin
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
      <PresupuestosClient
        initialMonth={view.initialMonth}
        initialData={view.initialData}
        months={view.months}
        cats={view.cats}
        accountOpts={view.accountOpts}
        local={view.local}
      />
    </>
  )
}

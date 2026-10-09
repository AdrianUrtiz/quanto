'use client'

import { useLiveQuery } from 'dexie-react-hooks'

import type { MonthOpt } from '@/components/activity-client'
import type { CreditStatementView } from '@/components/credit-statements'
import { ResumenClient } from '@/components/resumen-client'
import { PendingOutboxBanner } from '@/components/pending-outbox-banner'
import type {
  ResumenInvolvedTx,
  ResumenMineTx,
} from '@/components/resumen-client'

import type { CatalogRow } from '@/lib/catalog'
import { db } from '@/lib/offline/db'
import {
  deriveMonths,
  deriveStatements,
  toCatalog,
  toConfirmed,
  toInvolvedTxs,
  toMineTxs,
} from '@/lib/offline/derive-resumen'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { useSnapshotSync } from '@/lib/offline/useSnapshotSync'

type Props = {
  months: MonthOpt[]
  mine: ResumenMineTx[]
  involved: ResumenInvolvedTx[]
  confirmed: { key: string; amount: number }[]
  cats: CatalogRow[]
  statements: CreditStatementView[]
}

/**
 * Hidratación Dexie-first de Resumen: si hay copia local (online u offline)
 * se deriva el view-model desde IndexedDB y pinta al instante; los props
 * del servidor solo son fallback de primera carga. La revalidación corre
 * en background sin bloquear.
 */
export function ResumenShell(server: Props) {
  const online = useOnlineStatus()
  const { isRevalidating } = useSnapshotSync()
  const local = useLiveQuery(async () => {
    const [
      meta,
      transactions,
      accounts,
      categories,
      shares,
      lineSums,
      partnerShared,
    ] = await Promise.all([
      db.meta.get('sync'),
      db.transactions.toArray(),
      db.accounts.toArray(),
      db.categories.toArray(),
      db.shares.toArray(),
      db.lineSums.toArray(),
      db.partnerShared.toArray(),
    ])
    return {
      meta,
      transactions,
      accounts,
      categories,
      shares,
      lineSums,
      partnerShared,
    }
  }, [])

  const hasLocal =
    !!local && (local.transactions.length > 0 || local.accounts.length > 0)
  // Dexie-first: con copia local se usa siempre (online u offline).
  const useLocal = hasLocal

  const mine = useLocal ? toMineTxs(local.transactions) : server.mine
  // Meses solo con MIS gastos (igual que el servidor: sin parte de pareja).
  const mineTx = useLocal
    ? local.transactions.filter(
        (t) => !t.partnerShare && (t.type === 'EXPENSE' || t.type === 'INCOME'),
      )
    : []
  const view: Props = useLocal
    ? {
        mine,
        months: deriveMonths(mineTx),
        involved: toInvolvedTxs(
          local.transactions,
          local.accounts,
          local.shares,
          local.partnerShared,
        ),
        confirmed: toConfirmed(local.lineSums),
        cats: toCatalog(local.categories),
        statements: deriveStatements(local.accounts, local.transactions),
      }
    : server

  if (!online && !hasLocal) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-20 text-center">
        <p className="text-lg font-bold">Sin conexión</p>
        <p className="text-sm text-(--muted-foreground)">
          Conéctate una vez para descargar tus datos y ver tu resumen sin
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
      <ResumenClient
        months={view.months}
        mine={view.mine}
        involved={view.involved}
        confirmed={view.confirmed}
        cats={view.cats}
        statements={view.statements}
      />
    </>
  )
}

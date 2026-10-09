'use client'

import { useMemo, useState } from 'react'

import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CloudUpload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { db, type OfflineOutboxOp } from '@/lib/offline/db'
import {
  OUTBOX_KIND_CREATE_TX,
  discardFailedOp,
  reassignFailedOp,
  type CreateTxPayload,
} from '@/lib/offline/outbox'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { syncIfStale } from '@/lib/offline/useSnapshotSync'
import { formatMoney } from '@/lib/utils'
import { cn } from '@/lib/utils'

function parsePayload(op: OfflineOutboxOp): CreateTxPayload | null {
  if (op.kind !== OUTBOX_KIND_CREATE_TX) return null
  try {
    return JSON.parse(op.payload) as CreateTxPayload
  } catch {
    return null
  }
}

function FailedOpCard({
  op,
  payload,
  accountOptions,
}: {
  op: OfflineOutboxOp
  payload: CreateTxPayload
  accountOptions: { id: string; name: string; type: string }[]
}) {
  const [accountId, setAccountId] = useState(payload.accountId)
  const [destId, setDestId] = useState(payload.transferToAccountId ?? '')
  const [busy, setBusy] = useState(false)
  const isTransfer = payload.type === 'TRANSFER'

  async function retry() {
    if (busy) return
    if (!accountId) {
      toast.error('Elige una cuenta')
      return
    }
    if (isTransfer && (!destId || destId === accountId)) {
      toast.error('Elige una cuenta destino distinta')
      return
    }
    setBusy(true)
    try {
      await reassignFailedOp(op.localId!, {
        accountId,
        transferToAccountId: isTransfer ? destId : undefined,
      })
      await syncIfStale()
      toast.success('Movimiento reencolado para subir')
    } catch {
      toast.error('No se pudo reintentar, prueba de nuevo')
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (busy) return
    setBusy(true)
    try {
      await discardFailedOp(op.localId!)
      toast.success('Movimiento descartado')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-3xl border border-red-500/40 bg-red-500/[0.07] p-3.5">
      <p className="text-sm font-semibold">
        {payload.concept} · {formatMoney(payload.amount)}
      </p>
      <p className="mt-0.5 text-xs text-(--muted-foreground)">
        No se pudo subir: {op.error ?? 'error desconocido'}
      </p>
      <div className="mt-2 space-y-2">
        <label className="block text-xs font-semibold">
          Cuenta
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 w-full rounded-2xl border border-(--border) bg-(--card) px-3 py-2.5 text-sm font-normal">
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {isTransfer && (
          <label className="block text-xs font-semibold">
            Cuenta destino
            <select
              value={destId}
              onChange={(e) => setDestId(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-(--border) bg-(--card) px-3 py-2.5 text-sm font-normal">
              {accountOptions
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            disabled={busy}
            onClick={retry}>
            {busy ? 'Reintentando…' : 'Asignar y reintentar'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={discard}>
            Descartar
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Cola offline: línea ámbar con pendientes + tarjeta roja de acciones
 * urgentes para rechazos del servidor (cuenta eliminada, etc.) con
 * reasignación de cuenta y reintento.
 */
export function PendingOutboxBanner({ compact }: { compact?: boolean }) {
  const online = useOnlineStatus()
  const data = useLiveQuery(async () => {
    const [ops, accounts] = await Promise.all([
      db.outbox.toArray(),
      db.accounts.toArray(),
    ])
    return { ops, accounts }
  }, [])

  const { pending, failed } = useMemo(() => {
    const ops = data?.ops ?? []
    return {
      pending: ops.filter((o) => o.status === 'PENDING'),
      failed: ops.filter((o) => o.status === 'FAILED'),
    }
  }, [data])

  const accountOptions = useMemo(
    () =>
      (data?.accounts ?? [])
        .filter((a) => !a.isHidden)
        .map((a) => ({ id: a.id, name: a.name, type: a.type })),
    [data],
  )

  if (!pending.length && !failed.length) return null

  return (
    <div className={cn('space-y-2', !compact && 'px-5 pt-4')}>
      {pending.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5 text-xs font-semibold text-amber-500">
          <CloudUpload className="size-4 shrink-0" />
          {pending.length === 1
            ? '1 movimiento sin subir'
            : `${pending.length} movimientos sin subir`}
          <span className="font-normal opacity-80">
            {online ? '· se sincronizan solos' : '· se subirán con red'}
          </span>
        </p>
      )}
      {failed.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-red-500">
            <AlertTriangle className="size-3.5" /> Acciones urgentes
          </p>
          {failed.map((op) => {
            const payload = parsePayload(op)
            if (!payload || op.localId == null) return null
            return (
              <FailedOpCard
                key={op.localId}
                op={op}
                payload={payload}
                accountOptions={accountOptions}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

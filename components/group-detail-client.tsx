'use client'

import { useState } from 'react'

import { ArrowLeft, Check, Copy, Plus, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { BottomSheet } from '@/components/bottom-sheet'
import {
  type GroupAccountOpt,
  GroupExpenseForm,
  type GroupSeatOpt,
} from '@/components/group-expense-form'
import { PaymentSheet } from '@/components/payment-sheet'
import { type AccountOpt } from '@/components/transaction-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import type { CatalogRow } from '@/lib/catalog'
import { type GroupDetail, addGroupSeats } from '@/lib/group-actions'
import { syncForce } from '@/lib/offline/useSnapshotSync'
import { cancelPayment } from '@/lib/payment-actions'
import { formatMoney } from '@/lib/utils'

/** Detalle del grupo (online): miembros, gastos, pagos y + gasto grupal. */
export function GroupDetailClient({
  detail,
  accountOptions,
  cats,
}: {
  detail: GroupDetail
  accountOptions: AccountOpt[]
  cats: CatalogRow[]
}) {
  const router = useRouter()
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [paySheet, setPaySheet] = useState<{
    mode: 'receive' | 'pay'
    shareId: string
    concept: string
    payKey: string
    monthly: number
    paid: number
    pending: number
  } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [newSeats, setNewSeats] = useState('')
  const [adding, setAdding] = useState(false)

  const confirmTarget =
    detail.pending.toConfirm.find((p) => p.id === confirmId) ?? null

  function refresh() {
    void syncForce()
    router.refresh()
  }

  async function addSeats(e: React.FormEvent) {
    e.preventDefault()
    if (!newSeats.trim()) return
    setAdding(true)
    try {
      const fd = new FormData()
      fd.set('seats', newSeats)
      const res = await addGroupSeats(detail.id, fd)
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Integrantes agregados')
        setNewSeats('')
        refresh()
      }
    } finally {
      setAdding(false)
    }
  }

  const seatOpts: GroupSeatOpt[] = detail.members.map((m) => ({
    id: m.id,
    displayName:
      m.displayName +
      (m.occupantName && m.occupantName !== m.displayName
        ? ` · ${m.occupantName}`
        : ''),
    occupied: m.occupied,
    isMe: m.isMe,
  }))
  const expenseAccountOpts: GroupAccountOpt[] = accountOptions.map((a) => ({
    id: a.id,
    name: a.name,
  }))

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-center gap-2">
        <Link
          href="/cuentas"
          aria-label="Volver a Cuentas"
          className="flex size-9 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-extrabold tracking-tight">
            {detail.name}
          </p>
          <p className="text-xs text-(--muted-foreground)">
            {detail.members.length}{' '}
            {detail.members.length === 1 ? 'integrante' : 'integrantes'} ·{' '}
            {detail.expenses.length}{' '}
            {detail.expenses.length === 1 ? 'gasto' : 'gastos'}
          </p>
        </div>
        {detail.code && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(detail.code ?? '')
              toast.success('Código copiado, compártelo')
            }}
            className="flex items-center gap-1.5 rounded-full bg-(--muted) px-3 py-2 text-xs font-bold tracking-wider transition active:scale-95">
            {detail.code} <Copy className="size-3.5" />
          </button>
        )}
      </div>

      {/* Miembros y saldos */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-(--muted-foreground)">
          Integrantes
        </p>
        {detail.members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3 rounded-3xl border border-(--border) p-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15">
              <Users className="size-4 text-sky-500" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {m.displayName}
                {m.isMe && ' (tú)'}
              </span>
              <span className="block truncate text-xs text-(--muted-foreground)">
                {m.occupied
                  ? (m.occupantName ?? 'Ocupado')
                  : 'Sin reclamar · pagó ' + formatMoney(m.paid)}
                {m.occupied && ` · pagó ${formatMoney(m.paid)}`}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm font-extrabold">
              {m.balance === 0 ? (
                'A mano'
              ) : m.balance > 0 ? (
                <span className="text-emerald-500">
                  +{formatMoney(m.balance)}
                </span>
              ) : (
                <span className="text-amber-500">{formatMoney(m.balance)}</span>
              )}
            </span>
          </div>
        ))}
        {detail.isCreator && (
          <form onSubmit={addSeats} className="flex gap-2">
            <Input
              value={newSeats}
              onChange={(e) => setNewSeats(e.target.value)}
              placeholder="Agregar: Axel, Kari…"
              className="flex-1"
            />
            <Button type="submit" disabled={adding || !newSeats.trim()}>
              Añadir
            </Button>
          </form>
        )}
      </section>

      {/* Por confirmar (me pagaron, yo confirmo) */}
      {detail.pending.toConfirm.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            Por confirmar ·{' '}
            {formatMoney(
              detail.pending.toConfirm.reduce((a, p) => a + p.amount, 0),
            )}
          </p>
          {detail.pending.toConfirm.map((p) => (
            <button
              key={p.id}
              onClick={() => setConfirmId(p.id)}
              className="flex w-full items-center gap-3 rounded-3xl border border-emerald-500/40 p-4 text-left transition active:scale-[.99]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {p.concept} · {p.monthLabel}
                </span>
                <span className="block truncate text-xs text-(--muted-foreground)">
                  {p.registeredByName} dice que te pagó
                </span>
              </span>
              <span className="text-base font-extrabold">
                {formatMoney(p.amount)}
              </span>
            </button>
          ))}
        </section>
      )}

      {/* Mis pendientes */}
      {detail.pending.myPending.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            En espera de confirmación
          </p>
          {detail.pending.myPending.map((p) => (
            <MyPendingRow key={p.id} p={p} onDone={refresh} />
          ))}
        </section>
      )}

      {/* Gastos */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            Gastos
          </p>
          <button
            type="button"
            onClick={() => setExpenseOpen(true)}
            className="flex items-center gap-1 rounded-full bg-(--primary) px-3 py-1.5 text-xs font-bold text-(--primary-foreground) transition active:scale-95">
            <Plus className="size-3.5" /> Gasto grupal
          </button>
        </div>
        {detail.expenses.length === 0 && (
          <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
            Aún no hay gastos. Registra el primero con + Gasto grupal.
          </p>
        )}
        {detail.expenses.map((t) => (
          <div
            key={t.id}
            className="space-y-1 rounded-3xl border border-(--border) p-4">
            <p className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold">{t.concept}</span>
              <span className="shrink-0 text-base font-extrabold">
                {formatMoney(t.amount)}
              </span>
            </p>
            <p className="text-xs text-(--muted-foreground)">
              Lo pagó {t.creatorName}
              {t.accountName && ` · ${t.accountName}`} ·{' '}
              {new Date(t.date).toLocaleDateString('es-MX', {
                day: 'numeric',
                month: 'short',
              })}
            </p>
            <ul className="space-y-1 border-t border-(--border) pt-2">
              {t.shares.map((s) => {
                const rest = Math.max(0, s.monthly - s.paid)
                const settled = rest <= 0
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                      {s.seatName}
                      {s.debtorName &&
                        s.debtorName !== s.seatName &&
                        ` (${s.debtorName})`}
                      {s.paid > 0 && (
                        <span className="text-(--muted-foreground)">
                          {' '}
                          · abonó {formatMoney(s.paid)}
                        </span>
                      )}
                      {s.pending > 0 && (
                        <span className="text-amber-500">
                          {' '}
                          · por confirmar {formatMoney(s.pending)}
                        </span>
                      )}
                    </span>
                    {settled ? (
                      <span className="flex shrink-0 items-center gap-1 font-semibold text-emerald-500">
                        <Check className="size-3" /> Listo
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-2">
                        <b>{formatMoney(rest)}</b>
                        {(s.isMine || t.isMine) && (
                          <button
                            type="button"
                            onClick={() =>
                              setPaySheet({
                                mode: s.isMine ? 'pay' : 'receive',
                                shareId: s.id,
                                concept: t.concept,
                                payKey: t.payKey,
                                monthly: s.monthly,
                                paid: s.paid,
                                pending: s.pending,
                              })
                            }
                            className="rounded-full bg-(--muted) px-2.5 py-1 text-[11px] font-bold transition active:scale-95">
                            {s.isMine ? 'Pagar' : 'Cobrar'}
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>

      <BottomSheet open={expenseOpen} onOpenChange={setExpenseOpen}>
        <GroupExpenseForm
          householdId={detail.id}
          householdName={detail.name}
          accountOptions={expenseAccountOpts}
          seats={seatOpts}
          cats={cats}
          onDone={() => {
            setExpenseOpen(false)
            refresh()
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={paySheet != null}
        onOpenChange={(o) => !o && setPaySheet(null)}>
        {paySheet && (
          <PaymentSheet
            key={`${paySheet.shareId}:${paySheet.mode}`}
            mode={paySheet.mode}
            lines={[
              {
                shareId: paySheet.shareId,
                concept: paySheet.concept,
                installment: 1,
                installments: 1,
                month: paySheet.payKey,
                monthly: paySheet.monthly,
                paid: paySheet.paid,
                pending: paySheet.pending,
              },
            ]}
            accountOptions={accountOptions}
            onDone={() => {
              setPaySheet(null)
              refresh()
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={confirmTarget != null}
        onOpenChange={(o) => !o && setConfirmId(null)}>
        {confirmTarget && (
          <PaymentSheet
            key={confirmTarget.id}
            mode="confirm"
            payment={confirmTarget}
            accountOptions={accountOptions}
            onDone={() => {
              setConfirmId(null)
              refresh()
            }}
          />
        )}
      </BottomSheet>
    </div>
  )
}

function MyPendingRow({
  p,
  onDone,
}: {
  p: { id: string; amount: number; monthLabel: string; concept: string }
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function cancel() {
    setBusy(true)
    const res = await cancelPayment(p.id)
    setBusy(false)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Registro cancelado')
      onDone()
    }
  }
  return (
    <div className="flex w-full items-center gap-3 rounded-3xl border border-dashed border-(--border) p-4">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {p.concept} · {p.monthLabel}
        </span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          En espera de confirmación
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">
          {formatMoney(p.amount)}
        </span>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="block text-[11px] font-semibold text-red-500 disabled:opacity-50">
          {busy ? 'Cancelando…' : 'Cancelar'}
        </button>
      </span>
    </div>
  )
}

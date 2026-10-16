'use client'

import { useMemo, useState } from 'react'

import {
  ArrowLeft,
  Check,
  HandCoins,
  Lock,
  LockOpen,
  MoreVertical,
  Pencil,
  Plus,
  Share2,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { BottomSheet } from '@/components/bottom-sheet'
import {
  type GroupAccountOpt,
  type GroupExpenseEntry,
  GroupExpenseForm,
  type GroupSeatOpt,
} from '@/components/group-expense-form'
import { PaymentSheet } from '@/components/payment-sheet'
import { type AccountOpt } from '@/components/transaction-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { deleteTransaction } from '@/lib/actions'
import type { CatalogRow } from '@/lib/catalog'
import {
  type GroupDetail,
  closeGroup,
  deleteGroup,
  reopenGroup,
  setGroupExpenseAccount,
} from '@/lib/group-actions'
import { suggestSettlements } from '@/lib/group-settle'
import {
  cancelSettlement,
  confirmSettlement,
  registerSettlement,
} from '@/lib/group-settlements'
import { syncForce } from '@/lib/offline/useSnapshotSync'
import { cancelPayment } from '@/lib/payment-actions'
import { cn, formatMoney, monthLabelEs } from '@/lib/utils'

const MEMBER_COLORS = [
  '#ef4444',
  '#0ea5e9',
  '#eab308',
  '#a855f7',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#84cc16',
  '#f43f5e',
  '#06b6d4',
]

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
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [claimId, setClaimId] = useState<string | null>(null)
  const [claimAccountId, setClaimAccountId] = useState('')
  const [claimBusy, setClaimBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tab, setTab] = useState<'gastos' | 'integrantes'>('gastos')
  const [suggestOpen, setSuggestOpen] = useState(false)
  // Editar/eliminar gasto: lo puede hacer quien lo registró o quien pagó.
  const [editTx, setEditTx] = useState<GroupDetail['expenses'][number] | null>(
    null,
  )
  const [delTx, setDelTx] = useState<GroupDetail['expenses'][number] | null>(
    null,
  )
  const [deleting, setDeleting] = useState(false)

  async function doDeleteExpense() {
    if (!delTx) return
    setDeleting(true)
    const res = await deleteTransaction(delTx.id)
    setDeleting(false)
    if ('error' in res && res.error) {
      toast.error(res.error)
    } else {
      toast.success('Gasto eliminado')
      setDelTx(null)
      refresh()
    }
  }

  function groupEntry(t: GroupDetail['expenses'][number]): GroupExpenseEntry {
    // El formulario trabaja con TOTALES por seat; la mensualidad guardada
    // se multiplica por los meses (la diferencia de centavos por redondeo
    // se ajusta en la última parte para que cuadre exacto con el total).
    const n = Math.max(1, t.installments)
    const debtorSplits = t.shares.flatMap((s) =>
      s.seatId ? [{ seatId: s.seatId, amount: s.monthly * n }] : [],
    )
    const payerConsumes = t.payerSeatId != null && t.payerPortion > 0.005
    const amounts = [
      ...debtorSplits,
      ...(payerConsumes && t.payerSeatId
        ? [{ seatId: t.payerSeatId, amount: t.payerPortion }]
        : []),
    ]
    const sum = amounts.reduce((a, s) => a + s.amount, 0)
    const drift = Math.round((t.amount - sum) * 100) / 100
    if (amounts.length > 0 && Math.abs(drift) > 0.0001) {
      amounts[amounts.length - 1].amount =
        Math.round((amounts[amounts.length - 1].amount + drift) * 100) / 100
    }
    return {
      id: t.id,
      amount: t.amount,
      concept: t.concept,
      category: t.category,
      date: t.date,
      payerSeatId: t.payerSeatId,
      installments: n,
      participantIds: amounts.map((s) => s.seatId),
      amounts,
    }
  }
  const [menuConfirm, setMenuConfirm] = useState<null | 'close' | 'delete'>(
    null,
  )
  const [menuBusy, setMenuBusy] = useState(false)

  const confirmTarget =
    detail.pending.toConfirm.find((p) => p.id === confirmId) ?? null

  // Sugerencia neteada: quién le paga a quién para dejar todo a mano.
  const suggestions = useMemo(
    () =>
      suggestSettlements(
        detail.members.map((m) => ({
          id: m.id,
          name: m.displayName + (m.isMe ? ' (tú)' : ''),
          balance: m.balance,
        })),
      ),
    [detail.members],
  )
  const mySeatId = detail.members.find((m) => m.isMe)?.id ?? null
  // Tope por sugerencia: lo que el deudor debe en neto (centavos).
  const netOwedCents = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of detail.members) {
      map.set(m.id, Math.max(0, -Math.round(m.balance * 100)))
    }
    return map
  }, [detail.members])

  // Liquidar una sugerencia: abre el sheet con monto y cuentas.
  const [settleTarget, setSettleTarget] = useState<{
    fromSeatId: string
    fromName: string
    toSeatId: string
    toName: string
    mode: 'pay' | 'receive' | 'confirm'
    amount: number
    cap: number
    settlementId?: string
  } | null>(null)

  function openSettle(
    s: (typeof suggestions)[number],
    mode: 'pay' | 'receive',
  ) {
    setSuggestOpen(false)
    setSettleTarget({
      fromSeatId: s.fromId,
      fromName: s.fromName,
      toSeatId: s.toId,
      toName: s.toName,
      mode,
      amount: s.amount,
      cap: (netOwedCents.get(s.fromId) ?? 0) / 100,
    })
  }

  async function cancelRow(id: string, kind: 'settlement' | 'share') {
    const res =
      kind === 'settlement'
        ? await cancelSettlement(id)
        : await cancelPayment(id)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Registro cancelado')
      refresh()
    }
  }
  const isClosed = detail.status === 'CLOSED'
  // Cerrar exige todo liquidado EN NETO (las sugerencias vacías lo prueban).
  const canClose =
    detail.settlements.toConfirm.length === 0 &&
    detail.settlements.myPending.length === 0 &&
    detail.members.every((m) => Math.abs(Math.round(m.balance * 100)) === 0)

  function refresh() {
    void syncForce()
    router.refresh()
  }

  async function runMenuAction(
    fn: () => Promise<{ error?: string }>,
    okMsg: string,
    after?: () => void,
  ) {
    setMenuBusy(true)
    try {
      const res = await fn()
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success(okMsg)
        setMenuOpen(false)
        setMenuConfirm(null)
        if (after) after()
        else refresh()
      }
    } finally {
      setMenuBusy(false)
    }
  }

  function copyCode() {
    if (!detail.code) return
    void navigator.clipboard?.writeText(detail.code)
    toast.success('Código copiado, compártelo')
  }

  function shareGroup() {
    if (!detail.code) return
    const text = `Únete a mi grupo "${detail.name}" en Tándem con el código ${detail.code}`
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string }) => Promise<void>
    }
    if (nav.share) {
      nav.share({ title: 'Grupo en Tándem', text }).catch(() => undefined)
    } else {
      void navigator.clipboard?.writeText(text)
      toast.success('Texto copiado para compartir')
    }
  }

  const claimTarget =
    detail.awaitingAccount.find((c) => c.id === claimId) ?? null

  async function confirmClaim() {
    if (!claimTarget || !claimAccountId) {
      toast.error('Elige de qué cuenta salió')
      return
    }
    setClaimBusy(true)
    try {
      const res = await setGroupExpenseAccount(claimTarget.id, claimAccountId)
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Cuenta indicada')
        setClaimId(null)
        refresh()
      }
    } finally {
      setClaimBusy(false)
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

  const memberColors = new Map<string, string>()
  const usedColorIndexes = new Set<number>()
  for (const member of detail.members) {
    let hash = 0
    for (let i = 0; i < member.id.length; i++) {
      hash = (hash * 31 + member.id.charCodeAt(i)) | 0
    }
    let colorIndex = (hash >>> 0) % MEMBER_COLORS.length

    // Evita repetir tonos para los integrantes visibles del grupo.
    while (
      usedColorIndexes.has(colorIndex) &&
      usedColorIndexes.size < MEMBER_COLORS.length
    ) {
      colorIndex = (colorIndex + 1) % MEMBER_COLORS.length
    }
    usedColorIndexes.add(colorIndex)
    memberColors.set(member.id, MEMBER_COLORS[colorIndex])
  }

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
          <p className="flex items-center gap-2 truncate text-2xl font-extrabold tracking-tight">
            <span className="truncate">{detail.name}</span>
            {isClosed && (
              <span className="shrink-0 rounded-full bg-(--muted) px-2.5 py-1 text-[10px] font-bold text-(--muted-foreground) uppercase">
                Cerrado
              </span>
            )}
          </p>
          <p className="text-xs text-(--muted-foreground)">
            {detail.members.length}{' '}
            {detail.members.length === 1 ? 'integrante' : 'integrantes'} ·{' '}
            {detail.expenses.length}{' '}
            {detail.expenses.length === 1 ? 'gasto' : 'gastos'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMenuConfirm(null)
            setMenuOpen(true)
          }}
          aria-label="Opciones del grupo"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
          <MoreVertical className="size-4" />
        </button>
      </div>

      {isClosed && (
        <p className="rounded-3xl border border-dashed border-(--border) p-4 text-center text-sm text-(--muted-foreground)">
          Grupo cerrado: todos a mano. Ya no se pueden agregar movimientos
          {detail.isCreator && ' (puedes reabrirlo desde el menú)'}.
        </p>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="gastos">Gastos</TabsTrigger>
          <TabsTrigger value="integrantes">Integrantes</TabsTrigger>
        </TabsList>
        <TabsContent value="gastos" className="space-y-4">
          {/* Sin cuenta: gastos que pagué y debo indicar de qué cuenta salieron */}
          {detail.awaitingAccount.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Indica de qué cuenta salió
              </p>
              {detail.awaitingAccount.map((c) => (
                <div
                  key={c.id}
                  className="space-y-1 rounded-3xl border border-amber-500/40 p-4">
                  <p className="text-sm font-semibold">
                    {c.registeredByName} dice que pagaste{' '}
                    {formatMoney(c.amount)}
                  </p>
                  <p className="text-xs text-(--muted-foreground)">
                    {c.concept} ·{' '}
                    {new Date(c.date).toLocaleDateString('es-MX', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                  {!isClosed && (
                    <button
                      type="button"
                      onClick={() => {
                        setClaimAccountId(accountOptions[0]?.id ?? '')
                        setClaimId(c.id)
                      }}
                      className="w-full rounded-2xl bg-amber-500 px-3 py-2 text-xs font-bold text-white transition active:scale-95">
                      ¿Desde qué cuenta fue?
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

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
            <p className="text-xs font-semibold text-(--muted-foreground)">
              Gastos
            </p>
            {detail.expenses.length === 0 && (
              <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
                {isClosed
                  ? 'Aún no hay gastos en este grupo.'
                  : 'Aún no hay gastos. Registra el primero con el botón +.'}
              </p>
            )}
            {detail.expenses.map((t) => (
              <div
                key={t.id}
                className="space-y-1 rounded-3xl border border-(--border) p-4">
                <p className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold">
                    {t.concept}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {t.installments > 1 && (
                      <span className="rounded-full bg-(--muted) px-2 py-0.5 text-[10px] font-bold text-(--muted-foreground)">
                        {t.installments} MSI
                      </span>
                    )}
                    {(t.isMine || t.isPayerMe) && !isClosed && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditTx(t)}
                          aria-label={`Editar ${t.concept}`}
                          className="flex size-7 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDelTx(t)}
                          aria-label={`Eliminar ${t.concept}`}
                          className="flex size-7 items-center justify-center rounded-full bg-(--muted) text-red-500 transition active:scale-95">
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                    <span className="text-base font-extrabold">
                      {formatMoney(t.amount)}
                    </span>
                  </span>
                </p>
                <p className="text-xs text-(--muted-foreground)">
                  Lo pagó {t.payerName}
                  {t.accountName
                    ? ` · ${t.accountName}`
                    : ' · Sin cuenta'} ·{' '}
                  {new Date(t.date).toLocaleDateString('es-MX', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </p>
                <ul className="space-y-1 border-t border-(--border) pt-2">
                  {t.shares.map((s) => {
                    const total = s.monthly * t.installments
                    const paidTotal = s.months.reduce((a, m) => a + m.paid, 0)
                    const rest = Math.max(0, total - paidTotal)
                    const settled = rest <= 0
                    return (
                      <li key={s.id} className="space-y-0.5 text-xs">
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold">
                            {s.seatName}
                            {s.debtorName &&
                              s.debtorName !== s.seatName &&
                              ` (${s.debtorName})`}
                          </span>
                          {settled ? (
                            <span className="flex shrink-0 items-center gap-1 font-semibold text-emerald-500">
                              <Check className="size-3" /> Listo
                            </span>
                          ) : (
                            <b className="shrink-0">{formatMoney(rest)}</b>
                          )}
                        </span>
                        {t.installments > 1 ? (
                          <span className="block space-y-0.5 pl-1">
                            {s.months.map((m, i) => {
                              const monthRest = Math.max(0, s.monthly - m.paid)
                              if (
                                monthRest <= 0 &&
                                m.paid <= 0 &&
                                m.pending <= 0
                              )
                                return null
                              return (
                                <span
                                  key={m.payKey}
                                  className="flex items-center justify-between gap-2 text-(--muted-foreground)">
                                  <span>
                                    {i + 1}/{t.installments} ·{' '}
                                    {monthLabelEs(
                                      new Date(
                                        Number(m.payKey.slice(0, 4)),
                                        Number(m.payKey.slice(5, 7)) - 1,
                                        1,
                                      ),
                                    )}{' '}
                                    · {formatMoney(s.monthly)}/mes
                                    {m.paid > 0 && (
                                      <> · abonó {formatMoney(m.paid)}</>
                                    )}
                                    {m.pending > 0 && (
                                      <span className="text-amber-500">
                                        {' '}
                                        · por confirmar {formatMoney(m.pending)}
                                      </span>
                                    )}
                                  </span>
                                  <b className="shrink-0 text-(--foreground)">
                                    {formatMoney(monthRest)}
                                  </b>
                                </span>
                              )
                            })}
                          </span>
                        ) : (
                          (s.paid > 0 || s.pending > 0) && (
                            <span className="block pl-1 text-(--muted-foreground)">
                              {s.paid > 0 && <>abonó {formatMoney(s.paid)}</>}
                              {s.paid > 0 && s.pending > 0 && ' · '}
                              {s.pending > 0 && (
                                <span className="text-amber-500">
                                  por confirmar {formatMoney(s.pending)}
                                </span>
                              )}
                            </span>
                          )
                        )}
                      </li>
                    )
                  })}
                </ul>
                {t.payerPortion > 0 && (
                  <p className="flex justify-between gap-2 border-t border-(--border) pt-1.5 text-xs text-(--muted-foreground)">
                    <span className="truncate">
                      {t.isMine ? 'Tu parte' : `Parte de ${t.creatorName}`}
                    </span>
                    <span className="shrink-0 font-bold text-(--foreground)">
                      {formatMoney(t.payerPortion)}
                    </span>
                  </p>
                )}
              </div>
            ))}
          </section>
        </TabsContent>
        <TabsContent value="integrantes" className="space-y-4">
          {/* Pagos sugeridos: neteo + registro por línea original */}
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setSuggestOpen(true)}
              className="flex w-full items-center gap-3 rounded-3xl border border-(--border) p-4 text-left transition active:scale-[.99]">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15">
                <HandCoins className="size-5 text-emerald-500" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  Reembolsos sugeridos
                </span>
                <span className="block truncate text-xs text-(--muted-foreground)">
                  {suggestions.length === 0
                    ? 'Todo a mano 🎉'
                    : `${suggestions.length} ${suggestions.length === 1 ? 'pago pendiente' : 'pagos pendientes'}`}
                </span>
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-emerald-500">
                Ver ›
              </span>
            </button>
          </section>

          {/* Miembros y saldos */}
          <section className="space-y-2">
            <p className="text-xs font-semibold text-(--muted-foreground)">
              Integrantes
            </p>
            {detail.members.map((m) => {
              const color = memberColors.get(m.id) ?? MEMBER_COLORS[0]
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-3xl border border-(--border) p-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
                    style={{
                      backgroundColor: `${color}26`,
                      color,
                    }}>
                    <User className="size-4" />
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
                      <span className="text-amber-500">
                        {formatMoney(m.balance)}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </section>
        </TabsContent>
      </Tabs>
      <Dialog
        open={menuOpen}
        onOpenChange={(o) => {
          setMenuOpen(o)
          if (!o) setMenuConfirm(null)
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Opciones del grupo</DialogTitle>
          </DialogHeader>
          {menuConfirm == null ? (
            <div className="space-y-1">
              {detail.code && (
                <button
                  type="button"
                  onClick={copyCode}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)">
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">
                      Código: {detail.code}
                    </span>
                    <span className="block text-xs text-(--muted-foreground)">
                      Toca para copiar
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={shareGroup}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)">
                <Share2 className="size-5 text-(--muted-foreground)" />
                <span className="flex-1 text-sm font-semibold">
                  Compartir grupo
                </span>
              </button>
              {detail.isCreator && (
                <Link
                  href={`/cuentas/grupos/${detail.id}/integrantes`}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)">
                  <UserPlus className="size-5 text-(--muted-foreground)" />
                  <span className="flex-1 text-sm font-semibold">
                    Gestionar participantes
                  </span>
                </Link>
              )}
              {detail.isCreator &&
                (isClosed ? (
                  <button
                    type="button"
                    disabled={menuBusy}
                    onClick={() =>
                      runMenuAction(
                        () => reopenGroup(detail.id),
                        'Grupo reabierto',
                      )
                    }
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted) disabled:opacity-50">
                    <LockOpen className="size-5 text-(--muted-foreground)" />
                    <span className="flex-1 text-sm font-semibold">
                      Reabrir grupo
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={menuBusy || !canClose}
                    title={
                      canClose
                        ? undefined
                        : 'Liquida todos los saldos para cerrar'
                    }
                    onClick={() => setMenuConfirm('close')}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted) disabled:opacity-50">
                    <Lock className="size-5 text-(--muted-foreground)" />
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">
                        Cerrar grupo
                      </span>
                      <span className="block text-xs text-(--muted-foreground)">
                        {canClose
                          ? 'Todos a mano: congela movimientos'
                          : 'Disponible cuando todos estén a mano'}
                      </span>
                    </span>
                  </button>
                ))}
              {detail.isCreator && (
                <button
                  type="button"
                  disabled={menuBusy}
                  onClick={() => setMenuConfirm('delete')}
                  className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-red-500 transition hover:bg-(--muted) disabled:opacity-50">
                  <Trash2 className="size-5" />
                  <span className="flex-1 text-sm font-semibold">
                    Eliminar grupo
                  </span>
                </button>
              )}
            </div>
          ) : menuConfirm === 'close' ? (
            <div className="space-y-3 px-1 pb-1 text-center">
              <p className="text-sm font-bold">¿Cerrar el grupo?</p>
              <p className="text-xs text-(--muted-foreground)">
                Ya no se podrán agregar movimientos ni integrantes. Tus gastos
                se conservan.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={menuBusy}
                  onClick={() => setMenuConfirm(null)}
                  className="h-11 flex-1 rounded-2xl border border-(--border) text-sm font-semibold disabled:opacity-50">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={menuBusy}
                  onClick={() =>
                    runMenuAction(() => closeGroup(detail.id), 'Grupo cerrado')
                  }
                  className="h-11 flex-1 rounded-2xl bg-(--primary) text-sm font-bold text-(--primary-foreground) disabled:opacity-50">
                  {menuBusy ? 'Cerrando…' : 'Cerrar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 px-1 pb-1 text-center">
              <p className="text-sm font-bold">¿Eliminar el grupo?</p>
              <p className="text-xs text-(--muted-foreground)">
                Se borran sus deudas. Tus movimientos de dinero se conservan
                como gastos personales.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={menuBusy}
                  onClick={() => setMenuConfirm(null)}
                  className="h-11 flex-1 rounded-2xl border border-(--border) text-sm font-semibold disabled:opacity-50">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={menuBusy}
                  onClick={() =>
                    runMenuAction(
                      () => deleteGroup(detail.id),
                      'Grupo eliminado',
                      () => {
                        router.push('/cuentas')
                        router.refresh()
                      },
                    )
                  }
                  className="h-11 flex-1 rounded-2xl bg-red-500 text-sm font-bold text-white disabled:opacity-50">
                  {menuBusy ? 'Eliminando…' : 'Eliminar'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {!isClosed && tab === 'gastos' && (
        <button
          type="button"
          onClick={() => setExpenseOpen(true)}
          aria-label="Agregar gasto grupal"
          className="fixed right-5 bottom-24 z-40 flex size-14 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) shadow-2xl transition active:scale-95">
          <Plus className="size-7" />
        </button>
      )}

      <BottomSheet open={expenseOpen} onOpenChange={setExpenseOpen}>
        <GroupExpenseForm
          householdId={detail.id}
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
        open={suggestOpen}
        onOpenChange={(o) => !o && setSuggestOpen(false)}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
          <div className="space-y-1 text-center">
            <p className="text-base font-extrabold">Reembolsos sugeridos</p>
            <p className="text-xs text-(--muted-foreground)">
              Quién le paga a quién para dejar todo a mano
            </p>
          </div>
          {suggestions.length === 0 &&
          detail.settlements.toConfirm.length === 0 &&
          detail.settlements.myPending.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
              Todo a mano 🎉
            </p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s, i) => {
                const mine =
                  mySeatId != null &&
                  (s.fromId === mySeatId || s.toId === mySeatId)
                return (
                  <li
                    key={`${s.fromId}-${s.toId}-${i}`}
                    className="flex items-center gap-2 rounded-3xl border border-(--border) p-4">
                    <span className="min-w-0 flex-1 text-sm">
                      <b>{s.fromName}</b>
                      <span className="text-(--muted-foreground)">
                        {' '}
                        le paga{' '}
                      </span>
                      <b>{formatMoney(s.amount)}</b>
                      <span className="text-(--muted-foreground)"> a </span>
                      <b>{s.toName}</b>
                    </span>
                    {mine && !isClosed && (
                      <button
                        type="button"
                        onClick={() =>
                          openSettle(
                            s,
                            s.fromId === mySeatId ? 'pay' : 'receive',
                          )
                        }
                        className={
                          s.fromId === mySeatId
                            ? 'shrink-0 rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white transition active:scale-95'
                            : 'shrink-0 rounded-full bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white transition active:scale-95'
                        }>
                        {s.fromId === mySeatId ? 'Pagar' : 'Cobrar'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {detail.settlements.toConfirm.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Por confirmar ·{' '}
                {formatMoney(
                  detail.settlements.toConfirm.reduce(
                    (a, p) => a + p.amount,
                    0,
                  ),
                )}
              </p>
              {detail.settlements.toConfirm.map((p) => (
                <SettlementPendingRow
                  key={p.id}
                  text={`${p.fromName} dice que te pagó ${formatMoney(p.amount)}`}
                  onPrimary={() => {
                    setSuggestOpen(false)
                    setSettleTarget({
                      fromSeatId: p.fromSeatId,
                      fromName: p.fromName,
                      toSeatId: p.toSeatId,
                      toName: p.toName,
                      mode: 'confirm',
                      amount: p.amount,
                      cap: p.amount,
                      settlementId: p.id,
                    })
                  }}
                  primaryLabel="Confirmar"
                  primaryClass="bg-emerald-500 text-white"
                  onCancel={() => void cancelRow(p.id, 'settlement')}
                />
              ))}
            </section>
          )}
          {detail.settlements.myPending.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                En espera de confirmación
              </p>
              {detail.settlements.myPending.map((p) => (
                <SettlementPendingRow
                  key={p.id}
                  text={`${p.toName} debe confirmar ${formatMoney(p.amount)}`}
                  onPrimary={() => void cancelRow(p.id, 'settlement')}
                  primaryLabel="Cancelar"
                  primaryClass="bg-(--muted) text-red-500"
                />
              ))}
            </section>
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={settleTarget != null}
        onOpenChange={(o) => !o && setSettleTarget(null)}>
        {settleTarget && (
          <SettlementSheet
            key={`${settleTarget.fromSeatId}:${settleTarget.toSeatId}:${settleTarget.mode}:${settleTarget.settlementId ?? ''}`}
            target={settleTarget}
            householdId={detail.id}
            accountOptions={accountOptions}
            onDone={() => {
              setSettleTarget(null)
              refresh()
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet
        open={editTx != null}
        onOpenChange={(o) => !o && setEditTx(null)}>
        {editTx && (
          <GroupExpenseForm
            key={editTx.id}
            householdId={detail.id}
            accountOptions={expenseAccountOpts}
            seats={seatOpts}
            cats={cats}
            entry={groupEntry(editTx)}
            onDone={() => {
              setEditTx(null)
              refresh()
            }}
          />
        )}
      </BottomSheet>

      <Dialog open={delTx != null} onOpenChange={(o) => !o && setDelTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar {delTx?.concept}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-(--muted-foreground)">
            Se borra el gasto del grupo ({delTx && formatMoney(delTx.amount)}) y
            las deudas que generó. Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setDelTx(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleting}
              onClick={() => void doDeleteExpense()}>
              {deleting ? 'Eliminando…' : 'Sí, eliminar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BottomSheet
        open={claimTarget != null}
        onOpenChange={(o) => !o && setClaimId(null)}>
        {claimTarget && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
            <div className="space-y-1 text-center">
              <p className="text-sm font-bold">
                {claimTarget.concept} · {formatMoney(claimTarget.amount)}
              </p>
              <p className="text-xs text-(--muted-foreground)">
                {claimTarget.registeredByName} dice que pagaste tú. Elige de qué
                cuenta salió: se creará tu movimiento personal.
              </p>
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {accountOptions.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setClaimAccountId(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)',
                      claimAccountId === a.id && 'bg-(--muted)',
                    )}>
                    <span className="flex-1 text-sm font-semibold">
                      {a.name}
                    </span>
                    {claimAccountId === a.id && (
                      <Check className="size-4 text-(--primary)" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              className="h-12 w-full rounded-2xl text-base"
              disabled={claimBusy || !claimAccountId}
              onClick={() => void confirmClaim()}>
              {claimBusy ? 'Guardando…' : 'Confirmar gasto'}
            </Button>
          </div>
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

function SettlementPendingRow({
  text,
  onPrimary,
  primaryLabel,
  primaryClass,
  onCancel,
}: {
  text: string
  onPrimary: () => void
  primaryLabel: string
  primaryClass?: string
  onCancel?: () => void
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-3xl border border-dashed border-(--border) p-4">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onPrimary}
          className={cn(
            'rounded-full px-3 py-1.5 text-[11px] font-bold transition active:scale-95',
            primaryClass,
          )}>
          {primaryLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Descartar"
            className="flex size-8 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
            <X className="size-3.5" />
          </button>
        )}
      </span>
    </div>
  )
}

/** Registrar/confirmar una liquidación neteada (monto + cuenta propia). */
function SettlementSheet({
  householdId,
  target,
  accountOptions,
  onDone,
}: {
  householdId: string
  target: {
    fromSeatId: string
    fromName: string
    toSeatId: string
    toName: string
    mode: 'pay' | 'receive' | 'confirm'
    amount: number
    cap: number
    settlementId?: string
  }
  accountOptions: { id: string; name: string }[]
  onDone: () => void
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(String(target.amount))
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? '')
  const [withMovement, setWithMovement] = useState(target.mode !== 'pay')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const maxAmount = Math.max(0.01, target.cap > 0 ? target.cap : target.amount)

  async function submit() {
    setMsg(null)
    const value = Number(amount)
    if (!(value > 0)) {
      setMsg('Monto inválido')
      return
    }
    if (value - maxAmount > 0.0001) {
      setMsg(`Solo restan ${formatMoney(maxAmount)}`)
      return
    }
    if (target.mode !== 'pay' && !accountId) {
      setMsg('Elige la cuenta')
      return
    }
    if (target.mode === 'pay' && withMovement && !accountId) {
      setMsg('Elige la cuenta o registra sin movimiento')
      return
    }
    setPending(true)
    try {
      if (target.mode === 'confirm' && target.settlementId) {
        const res = await confirmSettlement(target.settlementId, accountId)
        if ('error' in res && res.error) {
          setMsg(res.error)
          toast.error(res.error)
        } else {
          toast.success('Liquidación confirmada')
          onDone()
          router.refresh()
        }
        return
      }
      const res = await registerSettlement({
        householdId,
        fromSeatId: target.fromSeatId,
        toSeatId: target.toSeatId,
        amount: value,
        accountId:
          target.mode === 'pay' && !withMovement ? undefined : accountId,
      })
      if ('error' in res && res.error) {
        setMsg(res.error)
        toast.error(res.error)
      } else {
        toast.success(
          target.mode === 'pay'
            ? 'Registrado, en espera de confirmación'
            : 'Liquidación registrada',
        )
        onDone()
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="text-base font-extrabold">
          {target.mode === 'confirm'
            ? 'Confirmar liquidación'
            : target.mode === 'pay'
              ? `Pagar a ${target.toName}`
              : `Cobrar a ${target.fromName}`}
        </p>
        <p className="text-xs text-(--muted-foreground)">
          {target.mode === 'confirm'
            ? `${target.fromName} dice que te pagó. Elige dónde lo recibiste.`
            : `Liquidación neteada del grupo (resta ${formatMoney(maxAmount)} como máximo).`}
        </p>
      </div>
      {target.mode !== 'confirm' && (
        <div className="space-y-1.5">
          <Label htmlFor="settle-amount">Monto</Label>
          <Input
            id="settle-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onFocus={(e) => e.target.select()}
            autoComplete="off"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>
          {target.mode === 'pay'
            ? 'De qué cuenta salió (opcional)'
            : 'A qué cuenta llegó'}
        </Label>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {target.mode === 'pay' && (
            <li>
              <button
                type="button"
                onClick={() => setWithMovement(false)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)',
                  !withMovement && 'bg-(--muted)',
                )}>
                <span className="flex-1 text-sm font-semibold">
                  Solo registrar, sin movimiento
                </span>
                {!withMovement && <Check className="size-4 text-(--primary)" />}
              </button>
            </li>
          )}
          {accountOptions.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setAccountId(a.id)
                  if (target.mode === 'pay') setWithMovement(true)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)',
                  withMovement && accountId === a.id && 'bg-(--muted)',
                )}>
                <span className="flex-1 text-sm font-semibold">{a.name}</span>
                {withMovement && accountId === a.id && (
                  <Check className="size-4 text-(--primary)" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {msg && (
        <p className="text-center text-sm font-medium text-red-500">{msg}</p>
      )}
      <Button
        type="button"
        className="h-12 w-full rounded-2xl text-base"
        disabled={pending || (target.mode !== 'pay' && !accountId)}
        onClick={() => void submit()}>
        {pending
          ? 'Guardando…'
          : target.mode === 'confirm'
            ? 'Confirmar'
            : target.mode === 'pay'
              ? 'Registrar pago'
              : 'Registrar cobro'}
      </Button>
    </div>
  )
}

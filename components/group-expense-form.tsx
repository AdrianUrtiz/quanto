'use client'

import { useMemo, useState } from 'react'

import {
  ArrowLeftRight,
  CalendarClock,
  CalendarDays,
  Check,
  NotebookPen,
  Scale,
  Shapes,
  User,
  Wallet,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { AccountIcon } from '@/components/account-icon'
import { BottomSheet } from '@/components/bottom-sheet'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import type { CatalogRow } from '@/lib/catalog'
import { ICONS } from '@/lib/categories'
import { createGroupExpense, updateGroupExpense } from '@/lib/group-actions'
import { toCents } from '@/lib/money'
import { cn, formatMoney } from '@/lib/utils'
import { addWallDays, todayMexicoYMD, wallNow, ymdOfWall } from '@/lib/walltime'

export type GroupAccountOpt = {
  id: string
  name: string
  type?: string
  color?: string | null
}
export type GroupSeatOpt = {
  id: string
  displayName: string
  occupied: boolean
  isMe: boolean
}

/** Gasto existente para editar en el mismo formulario de registro. */
export type GroupExpenseEntry = {
  id: string
  amount: number
  concept: string
  category: string
  /** ISO. */
  date: string
  payerSeatId: string | null
  /** Meses del gasto (1 = contado). No editable (igual que en lo personal). */
  installments: number
  /** Participantes marcados (incluye al pagador si consume). */
  participantIds: string[]
  /** Importes por seat (deudores + parte del pagador si consume). */
  amounts: { seatId: string; amount: number }[]
}

type Sheet = null | 'date' | 'payer' | 'account' | 'cats' | 'msi'

const MSI_OPTS = [1, 3, 6, 9, 12, 15, 24]
const msiLabel = (m: number) => (m === 1 ? 'Contado' : `${m} MSI`)

function sanitizeAmount(v: string): string | null {
  const clean = v.replace(/[^0-9.]/g, '')
  if (clean === '') return ''
  const parts = clean.split('.')
  if (parts.length > 2) return null
  if (parts[0] && parts[0].length > 9) return null
  if (parts[1] != null && parts[1].length > 2) return null
  return clean
}

function CatGlyph({
  iconName,
  color,
  className,
}: {
  iconName?: string
  color?: string
  className?: string
}) {
  const Icon = (iconName && ICONS[iconName]) || Shapes
  return <Icon className={className} style={color ? { color } : undefined} />
}

/**
 * Gasto grupal estilo actividad: monto en grande, pills (fecha, concepto,
 * quién pagó, cuenta, categoría) y reparto por partes iguales o importes.
 * Si paga otro integrante, se guarda pendiente a que lo confirme.
 */
export function GroupExpenseForm({
  householdId,
  accountOptions,
  seats,
  cats,
  entry,
  onDone,
}: {
  householdId: string
  accountOptions: GroupAccountOpt[]
  seats: GroupSeatOpt[]
  cats: CatalogRow[]
  /** Si se pasa, el formulario edita ese gasto en vez de crear uno. */
  entry?: GroupExpenseEntry | null
  onDone: () => void
}) {
  const router = useRouter()
  const editing = entry != null
  // En edición las cantidades vienen del gasto guardado; si todas las
  // partes son iguales se muestra como "iguales", si no como "importes".
  const entryAmounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of entry?.amounts ?? []) map.set(a.seatId, a.amount)
    return map
  }, [entry])
  const entryMode: 'equal' | 'custom' = useMemo(() => {
    if (!entry || entry.participantIds.length === 0) return 'equal'
    const first = entryAmounts.get(entry.participantIds[0])
    if (first == null) return 'custom'
    return entry.participantIds.every(
      (id) => Math.abs((entryAmounts.get(id) ?? NaN) - first) < 0.005,
    )
      ? 'equal'
      : 'custom'
  }, [entry, entryAmounts])
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '')
  const [concept, setConcept] = useState(entry?.concept ?? '')
  const [editingConcept, setEditingConcept] = useState(false)
  const [category, setCategory] = useState(entry?.category ?? 'COMIDA')
  const [dateYMD, setDateYMD] = useState(
    entry ? ymdOfWall(new Date(entry.date)) : todayMexicoYMD(),
  )
  const [sheet, setSheet] = useState<Sheet>(null)
  const [payerId, setPayerId] = useState(
    () =>
      entry?.payerSeatId ??
      seats.find((s) => s.isMe)?.id ??
      seats[0]?.id ??
      '',
  )
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? '')
  // Meses sin intereses (solo al crear; al editar quedan fijos, igual que
  // en movimientos personales: las parcialidades ya registradas no se mueven).
  const [msi, setMsi] = useState(editing ? (entry!.installments || 1) : 1)
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(entryMode)
  const [picked, setPicked] = useState<string[]>(() =>
    editing
      ? entry!.participantIds.filter((id) => seats.some((s) => s.id === id))
      : seats.map((s) => s.id),
  )
  const [custom, setCustom] = useState<Record<string, string>>(() => {
    if (!editing || entryMode !== 'custom') return {}
    const out: Record<string, string> = {}
    for (const id of entry!.participantIds) {
      const v = entryAmounts.get(id)
      if (v != null) out[id] = String(v)
    }
    return out
  })
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const payer = seats.find((s) => s.id === payerId) ?? null
  const payerIsMe = payer?.isMe ?? true
  const total = Number(amount) || 0
  const totalC = toCents(amount || '0')

  // Deudores elegibles: todos menos quien pagó. El pagador también puede
  // consumir (checkbox en su fila): si no, solo reparte lo que pagó.
  const debtors = useMemo(
    () => seats.filter((s) => s.id !== payerId),
    [seats, payerId],
  )
  const payerChecked = picked.includes(payerId)
  // Si cambia el pagador, se resetea la selección a todos.
  function pickPayer(id: string) {
    setPayerId(id)
    setPicked(seats.map((s) => s.id))
    setCustom({})
    setSheet(null)
  }

  // Deudores marcados (sin el pagador): al menos uno.
  const debtorIds = picked.filter((id) => id !== payerId)
  // En partes iguales el divisor incluye al pagador solo si consume.
  const per =
    debtorIds.length > 0
      ? total / (debtorIds.length + (payerChecked ? 1 : 0))
      : 0
  // Lo que te deben en total (aprox; el servidor cuadra centavos).
  const owedTotal = Math.max(0, total - (payerChecked ? per : 0))
  // En importes todos ponen lo suyo, incluido el pagador: debe sumar el total.
  const customSum = Object.entries(custom).reduce(
    (a, [id, v]) => (picked.includes(id) ? a + (Number(v) || 0) : a),
    0,
  )
  const customSumC = toCents(String(customSum || '0'))
  const customValid =
    debtorIds.length > 0 &&
    customSumC === totalC &&
    picked.every((id) => Number(custom[id] || 0) > 0)

  const todayYMD = todayMexicoYMD()
  const yesterdayYMD = ymdOfWall(addWallDays(wallNow(), -1))
  const dateLabel =
    dateYMD === todayYMD
      ? 'Hoy'
      : dateYMD === yesterdayYMD
        ? 'Ayer'
        : dateYMD.slice(8, 10) + '/' + dateYMD.slice(5, 7)
  const accountLabel =
    accountOptions.find((a) => a.id === accountId)?.name ?? 'Cuenta'
  const catRow = cats.find((c) => c.code === category)

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setMsg(null)
    if (!(Number(amount) > 0)) {
      setMsg('Monto inválido')
      return
    }
    if (!concept.trim()) {
      setMsg('Agrega un concepto')
      return
    }
    if (!payer) {
      setMsg('Elige quién pagó')
      return
    }
    if (debtorIds.length === 0) {
      setMsg('Elige quiénes participan en el reparto')
      return
    }
    let splitsJson: string | undefined
    if (splitMode === 'custom') {
      if (!customValid) {
        setMsg(
          customSumC !== totalC
            ? 'Los importes deben sumar el total'
            : 'Reparte el monto entre integrantes',
        )
        return
      }
      splitsJson = JSON.stringify(
        picked.map((id) => ({ seatId: id, amount: Number(custom[id]) })),
      )
    }
    if (payerIsMe && !accountId && !editing) {
      setMsg('Elige de qué cuenta salió')
      return
    }
    setPending(true)
    try {
      const now = wallNow()
      const hh = String(now.getUTCHours()).padStart(2, '0')
      const mm = String(now.getUTCMinutes()).padStart(2, '0')
      const fd = new FormData()
      if (editing) fd.set('id', entry!.id)
      fd.set('householdId', householdId)
      fd.set('payerSeatId', payer.id)
      if (payerIsMe && !editing) fd.set('accountId', accountId)
      fd.set('amount', amount)
      fd.set('concept', concept.trim())
      fd.set('category', category)
      fd.set('date', `${dateYMD}T${hh}:${mm}`)
      fd.set('splitMode', splitMode)
      if (splitMode === 'custom' && splitsJson) {
        fd.set('splitsJson', splitsJson)
      }
      // Los meses solo se eligen al crear; al editar quedan fijos.
      if (!editing) fd.set('installments', String(msi))
      // Participantes (incluye al pagador si también consume).
      for (const id of picked) fd.append('seatIds', id)
      const res = editing
        ? await updateGroupExpense(fd)
        : await createGroupExpense(fd)
      if ('error' in res && res.error) {
        setMsg(res.error)
        toast.error(res.error)
      } else {
        toast.success(
          editing
            ? 'Gasto actualizado'
            : 'pending' in res
              ? `${payer.displayName} lo confirma al entrar`
              : 'Gasto grupal registrado',
        )
        onDone()
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-1 pb-6">
      {/* Monto en grande */}
      <div className="flex items-center justify-center gap-2 py-6">
        <span className="text-2xl font-bold text-(--muted-foreground)">$</span>
        <input
          value={amount}
          onChange={(e) => {
            setMsg(null)
            const next = sanitizeAmount(e.target.value)
            if (next !== null) setAmount(next)
          }}
          onFocus={(e) => e.target.select()}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          aria-label="Monto gastado"
          className="w-full max-w-56 bg-transparent text-center text-5xl font-extrabold tracking-tight tabular-nums outline-none placeholder:text-(--muted-foreground)/40"
        />
      </div>

      {/* Pills: fecha · concepto · quién pagó · cuenta · categoría */}
      {editingConcept ? (
        <div className="flex items-center gap-2 pb-1">
          <Input
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setEditingConcept(false)
            }}
            placeholder="Cena, Airbnb, gasolina…"
            maxLength={60}
            autoFocus
            className="h-11"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Confirmar concepto"
            onClick={() => setEditingConcept(false)}>
            <Check className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <button
            type="button"
            onClick={() => setSheet('date')}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold">
            <CalendarDays className="size-3.5" /> {dateLabel}
          </button>
          <button
            type="button"
            onClick={() => setEditingConcept(true)}
            className={cn(
              'flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold',
              concept
                ? 'border-transparent bg-(--foreground) text-(--background)'
                : 'border-(--border) bg-(--muted)/60',
            )}>
            <NotebookPen className="size-3.5" />
            <span className="truncate">{concept || 'Concepto'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSheet('payer')}
            className="flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold">
            <User className="size-3.5" />
            <span className="truncate">
              Pagó {payer ? payer.displayName : '…'}
            </span>
          </button>
          {payerIsMe && !editing && (
            <button
              type="button"
              onClick={() => setSheet('account')}
              className="flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold">
              <Wallet className="size-3.5" />
              <span className="truncate">{accountLabel}</span>
            </button>
          )}
          {!editing && (
            <button
              type="button"
              onClick={() => setSheet('msi')}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold',
                msi !== 1
                  ? 'border-transparent bg-(--foreground) text-(--background)'
                  : 'border-(--border) bg-(--muted)/60',
              )}>
              <CalendarClock className="size-3.5" /> {msiLabel(msi)}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSheet('cats')}
            className="flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold">
            <CatGlyph
              iconName={catRow?.iconName}
              color={catRow?.color}
              className="size-3.5 shrink-0"
            />
            <span className="truncate">{catRow?.name ?? 'Categoría'}</span>
          </button>
        </div>
      )}

      {/* Reparto */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            Reparto
          </p>
          <div className="grid w-fit grid-cols-2 gap-1 rounded-full bg-(--muted) p-0.5">
            {(['equal', 'custom'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSplitMode(m)}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-semibold',
                  splitMode === m
                    ? 'bg-(--card) shadow'
                    : 'text-(--muted-foreground)',
                )}>
                {m === 'equal' ? (
                  <span className="flex items-center gap-1">
                    <Scale className="size-3" /> Iguales
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <ArrowLeftRight className="size-3" /> Importes
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-1">
          {payer && (
            <li className="flex items-center gap-2 rounded-2xl border border-(--primary)/40 bg-(--primary)/5 px-3 py-2">
              <button
                type="button"
                onClick={() =>
                  setPicked((prev) =>
                    prev.includes(payer.id)
                      ? prev.filter((p) => p !== payer.id)
                      : [...prev, payer.id],
                  )
                }
                aria-pressed={payerChecked}
                aria-label="El pagador también consume"
                className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-(--primary) text-xs font-bold text-(--primary-foreground)">
                  {payerChecked && '✓'}
                </span>
                <span className="truncate text-sm font-semibold">
                  {payer.displayName}
                  {payer.isMe ? ' (tú)' : ''}
                </span>
                <span className="shrink-0 rounded-full bg-(--primary)/15 px-2 py-0.5 text-[10px] font-bold text-(--primary) uppercase">
                  Paga
                </span>
              </button>
              {splitMode === 'equal' ? (
                <span className="shrink-0 text-xs font-bold tabular-nums">
                  {total > 0 && payerChecked ? formatMoney(per) : '—'}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-xs font-bold text-(--muted-foreground)">
                    $
                  </span>
                  <input
                    value={payerChecked ? (custom[payer.id] ?? '') : ''}
                    onChange={(e) => {
                      const next = sanitizeAmount(e.target.value)
                      if (next === null) return
                      setCustom((prev) => ({ ...prev, [payer.id]: next }))
                      if (!payerChecked)
                        setPicked((prev) => [...prev, payer.id])
                    }}
                    onFocus={(e) => e.target.select()}
                    disabled={!payerChecked}
                    placeholder="0"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label={`Importe de ${payer.displayName}`}
                    className="h-9 w-24 rounded-xl border border-(--border) bg-(--card) px-2 text-right text-sm font-bold tabular-nums outline-none placeholder:text-(--muted-foreground)/40 disabled:opacity-40"
                  />
                </span>
              )}
            </li>
          )}
          {debtors.map((s) => {
            const on = picked.includes(s.id)
            return (
              <li
                key={s.id}
                className={cn(
                  'flex items-center gap-2 rounded-2xl border px-3 py-2 transition',
                  on ? 'border-(--border)' : 'opacity-50',
                )}>
                <button
                  type="button"
                  onClick={() =>
                    setPicked((prev) =>
                      prev.includes(s.id)
                        ? prev.filter((p) => p !== s.id)
                        : [...prev, s.id],
                    )
                  }
                  aria-pressed={on}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                      on
                        ? 'bg-(--primary) text-(--primary-foreground)'
                        : 'border border-(--border)',
                    )}>
                    {on && '✓'}
                  </span>
                  <span className="truncate text-sm font-semibold">
                    {s.displayName}
                  </span>
                </button>
                {splitMode === 'equal' ? (
                  <span className="shrink-0 text-xs font-bold tabular-nums">
                    {on && total > 0 ? formatMoney(per) : '—'}
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-xs font-bold text-(--muted-foreground)">
                      $
                    </span>
                    <input
                      value={custom[s.id] ?? ''}
                      onChange={(e) => {
                        const next = sanitizeAmount(e.target.value)
                        if (next === null) return
                        setCustom((prev) => ({ ...prev, [s.id]: next }))
                        if (!on) setPicked((prev) => [...prev, s.id])
                      }}
                      onFocus={(e) => e.target.select()}
                      disabled={!on}
                      placeholder="0"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`Importe de ${s.displayName}`}
                      className="h-9 w-24 rounded-xl border border-(--border) bg-(--card) px-2 text-right text-sm font-bold tabular-nums outline-none placeholder:text-(--muted-foreground)/40 disabled:opacity-40"
                    />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {splitMode === 'custom' ? (
          <p
            className={cn(
              'text-center text-xs font-semibold',
              customSumC > totalC
                ? 'text-red-500'
                : customValid
                  ? 'text-emerald-500'
                  : 'text-(--muted-foreground)',
            )}>
            Suman {formatMoney(customSum)} de {formatMoney(total)}
            {customValid ? ' ✓' : ''}
          </p>
        ) : (
          picked.length > 0 &&
          total > 0 && (
            <p className="text-center text-xs text-(--muted-foreground)">
              {formatMoney(per)} por persona · te deben {formatMoney(owedTotal)}{' '}
              en total
            </p>
          )
        )}
        {!payerIsMe && !editing && (
          <p className="rounded-2xl bg-amber-500/10 p-3 text-center text-xs font-medium text-amber-500">
            {payer?.displayName} lo confirma al entrar: elegirá de qué cuenta
            suya salió.
          </p>
        )}
      </div>

      {msg && (
        <p className="mt-2 text-center text-sm font-medium text-red-500">
          {msg}
        </p>
      )}
      <Button
        type="button"
        disabled={pending}
        onClick={() => void submit()}
        className="mt-3 h-12 w-full text-base">
        {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar gasto'}
      </Button>

      {/* Sheet: fecha */}
      <BottomSheet
        open={sheet === 'date'}
        onOpenChange={(o) => !o && setSheet(null)}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-6">
          <p className="text-center text-base font-extrabold">Fecha</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={dateYMD === todayYMD ? 'default' : 'secondary'}
              onClick={() => {
                setDateYMD(todayYMD)
                setSheet(null)
              }}>
              Hoy
            </Button>
            <Button
              type="button"
              variant={dateYMD === yesterdayYMD ? 'default' : 'secondary'}
              onClick={() => {
                setDateYMD(yesterdayYMD)
                setSheet(null)
              }}>
              Ayer
            </Button>
          </div>
          <Input
            type="date"
            value={dateYMD}
            onChange={(e) => {
              if (e.target.value) {
                setDateYMD(e.target.value)
                setSheet(null)
              }
            }}
          />
        </div>
      </BottomSheet>

      {/* Sheet: quién pagó */}
      <BottomSheet
        open={sheet === 'payer'}
        onOpenChange={(o) => !o && setSheet(null)}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-6">
          <p className="text-center text-base font-extrabold">¿Quién pagó?</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {seats.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pickPayer(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)',
                    payerId === s.id && 'bg-(--muted)',
                  )}>
                  <User className="size-4 text-(--muted-foreground)" />
                  <span className="flex-1 text-sm font-semibold">
                    {s.displayName}
                    {s.isMe && ' (tú)'}
                  </span>
                  {!s.occupied && (
                    <span className="text-xs text-(--muted-foreground)">
                      Sin reclamar
                    </span>
                  )}
                  {payerId === s.id && (
                    <Check className="size-4 text-(--primary)" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-center text-xs text-(--muted-foreground)">
            Si pagó alguien más, lo confirma al entrar con su cuenta.
          </p>
        </div>
      </BottomSheet>

      {/* Diálogo: cuenta (solo si pago yo) */}
      <Dialog
        open={sheet === 'account'}
        onOpenChange={(o) => !o && setSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿De qué cuenta salió?</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {accountOptions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAccountId(a.id)
                    setSheet(null)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)',
                    accountId === a.id && 'bg-(--muted)',
                  )}>
                  <AccountIcon type={a.type} color={a.color} />
                  <span className="flex-1 text-sm font-semibold">{a.name}</span>
                  {accountId === a.id && (
                    <Check className="size-4 text-(--primary)" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Diálogo: meses sin intereses (solo al crear) */}
      <Dialog open={sheet === 'msi'} onOpenChange={(o) => !o && setSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Meses sin intereses</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {MSI_OPTS.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => {
                    setMsi(m)
                    setSheet(null)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)',
                    msi === m && 'bg-(--muted)',
                  )}>
                  <span className="flex-1 text-sm font-semibold">
                    {msiLabel(m)}
                  </span>
                  {msi === m && <Check className="size-4 text-(--primary)" />}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Diálogo: categoría */}
      <Dialog
        open={sheet === 'cats'}
        onOpenChange={(o) => !o && setSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Categoría</DialogTitle>
          </DialogHeader>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {cats
              .filter((c) => c.kind === 'expense' || c.kind === 'both')
              .map((c) => {
                const active = category === c.code
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => {
                        setCategory(c.code)
                        setSheet(null)
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)',
                        active && 'bg-(--muted)',
                      )}>
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-2xl"
                        style={{
                          backgroundColor: `${c.color}26`,
                          color: c.color,
                        }}>
                        <CatGlyph iconName={c.iconName} className="size-4" />
                      </span>
                      <span className="flex-1 text-sm font-semibold">
                        {c.name}
                      </span>
                      {active && <Check className="size-4 text-(--primary)" />}
                    </button>
                  </li>
                )
              })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}

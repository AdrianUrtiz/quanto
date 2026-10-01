'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { Check, LayoutGrid, Plus, Repeat, Users, Wallet } from 'lucide-react'
import { toast } from 'sonner'

import type { AccountOpt } from '@/components/transaction-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import type { CatalogRow } from '@/lib/catalog'
import {
  CATEGORY_COLORS,
  ICONS,
  ICON_PRESETS,
  lookupCategory,
} from '@/lib/categories'
import { createCategory } from '@/lib/category-actions'
import {
  createSubscription,
  updateSubscription,
} from '@/lib/subscription-actions'
import { fromCents, normalizeMoney, toCents } from '@/lib/money'
import { formatMoney } from '@/lib/utils'
import { cn } from '@/lib/utils'

export type SubEditData = {
  id: string
  name: string
  amount: number
  category: string
  accountId: string
  chargeDay: number
  isShared: boolean
  sharePct: number
  shareAmount: number | null
}

const EXPENSE_KINDS = ['expense', 'both']

export function SubscriptionForm({
  subscription,
  accountOptions,
  cats = [],
  onDone,
}: {
  subscription?: SubEditData
  accountOptions: AccountOpt[]
  cats?: CatalogRow[]
  onDone?: () => void
}) {
  const editing = Boolean(subscription)
  const [name, setName] = useState(subscription?.name ?? '')
  const [amount, setAmount] = useState(
    subscription ? String(subscription.amount) : '',
  )
  const [day, setDay] = useState(
    subscription?.chargeDay ?? new Date().getDate(),
  )
  const [accountId, setAccountId] = useState(
    subscription?.accountId ?? accountOptions[0]?.id ?? '',
  )
  const [category, setCategory] = useState(
    subscription?.category ?? 'SUSCRIPCIONES',
  )
  const [shared, setShared] = useState(subscription?.isShared ?? false)
  const [shareMode, setShareMode] = useState<'pct' | 'amount'>(
    subscription?.shareAmount != null ? 'amount' : 'pct',
  )
  const [sharePct, setSharePct] = useState(subscription?.sharePct ?? 50)
  const [shareAmt, setShareAmt] = useState(
    subscription?.shareAmount != null ? String(subscription.shareAmount) : '',
  )
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [localRows, setLocalRows] = useState<CatalogRow[]>([])
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatIcon, setNewCatIcon] = useState<string>(ICON_PRESETS[0])
  const [newCatColor, setNewCatColor] = useState<string>('#fb923c')
  const [savingCat, setSavingCat] = useState(false)

  const totalC = toCents(amount || '0')
  const totalNum = fromCents(totalC)
  const preview =
    shareMode === 'pct'
      ? fromCents(Math.round((totalC * sharePct) / 100))
      : normalizeMoney(shareAmt || '0')

  const shareLabel = !shared
    ? 'Compartir'
    : shareMode === 'pct'
      ? `${sharePct}%`
      : shareAmt
        ? `$${fmtDisplay(shareAmt)}`
        : 'Compartir'

  // Catálogo de gasto (tabla + creadas en sesión); la elegida va primera.
  // Deduplica por código: la recién creada llega por `localRows` y —tras
  // revalidar— también por el prop `cats` (evita keys duplicadas).
  const expenseCats = useMemo(() => {
    const seen = new Set(cats.map((c) => c.code))
    const merged = [...cats, ...localRows.filter((r) => !seen.has(r.code))]
    const all = merged.filter((c) => EXPENSE_KINDS.includes(c.kind))
    const list = all.map((r) => lookupCategory(r.code, merged))
    if (category && !list.some((c) => c.code === category)) {
      list.unshift(lookupCategory(category, merged))
    }
    return list
  }, [cats, localRows, category])
  const selIdx = expenseCats.findIndex((c) => c.code === category)
  const sliderCats =
    selIdx > 0
      ? [
          expenseCats[selIdx],
          ...expenseCats.slice(0, selIdx),
          ...expenseCats.slice(selIdx + 1),
        ]
      : expenseCats

  async function saveCustomCat() {
    if (newCatName.trim().length < 2) {
      setMsg('La categoría necesita al menos 2 letras')
      return
    }
    setSavingCat(true)
    const fd = new FormData()
    fd.set('name', newCatName.trim())
    fd.set('iconName', newCatIcon)
    fd.set('color', newCatColor)
    fd.set('kind', 'expense')
    const res = await createCategory(fd)
    setSavingCat(false)
    if ('error' in res && res.error) {
      setMsg(res.error)
      return
    }
    if ('category' in res && res.category) {
      const c = res.category
      setLocalRows((prev) =>
        prev.some((x) => x.code === c.code)
          ? prev
          : [
              ...prev,
              {
                id: c.id,
                code: c.code,
                name: c.name,
                iconName: c.iconName,
                color: c.color,
                kind: c.kind as 'expense' | 'income' | 'both',
                isDefault: false,
                mine: true,
              },
            ],
      )
      setCategory(c.code)
    }
    setNewCatName('')
    setAddingCat(false)
    setMsg(null)
    toast.success('Categoría creada')
  }
  const sliderRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    sliderRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  }, [category])
  const [accOpen, setAccOpen] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const accountName =
    accountOptions.find((a) => a.id === accountId)?.name ?? 'Cuenta'

  function fmtDisplay(s: string) {
    if (!s) return '0'
    const [i, dec] = s.split('.')
    const int = Number(i || '0').toLocaleString('es-MX')
    return dec !== undefined ? `${int}.${dec}` : int
  }

  // Sanea lo que llega del teclado numérico nativo: dígitos y un punto
  // con hasta 2 decimales. Devuelve null si supera los 9 dígitos.
  function sanitizeAmount(v: string): string | null {
    let next = v.replace(/[^0-9.]/g, '')
    if (next === '') return ''
    const parts = next.split('.')
    if (parts.length > 2) next = parts[0] + '.' + parts.slice(1).join('')
    if (next.startsWith('.')) next = '0' + next
    const dot = next.indexOf('.')
    if (dot !== -1) next = next.slice(0, dot + 1) + next.slice(dot + 1, dot + 3)
    next = next.replace(/^0+(?=\d)/, '')
    if (next.replace('.', '').length > 9) return null
    return next
  }

  async function submit() {
    if (pending) return
    if (!totalNum || totalNum <= 0) {
      setMsg('Ingresa el monto mensual')
      return
    }
    if (!name.trim()) {
      setMsg('Ponle un nombre')
      return
    }
    if (!accountId) {
      setMsg('Elige la cuenta de cargo')
      return
    }
    if (shared && shareMode === 'amount') {
      const vC = toCents(shareAmt || '0')
      if (!shareAmt || Number.isNaN(vC) || vC <= 0 || vC > totalC) {
        setMsg('La aportación debe ser mayor a 0 y no mayor al total')
        return
      }
    }
    setMsg(null)
    setPending(true)
    const fd = new FormData()
    if (editing) fd.set('id', subscription!.id)
    fd.set('name', name.trim())
    fd.set('amount', String(totalNum))
    fd.set('chargeDay', String(day))
    fd.set('category', category)
    fd.set('accountId', accountId)
    fd.set('isShared', shared ? 'true' : 'false')
    if (shared) {
      if (shareMode === 'pct') fd.set('sharePct', String(sharePct))
      else fd.set('shareAmount', shareAmt)
    }
    const res = editing
      ? await updateSubscription(fd)
      : await createSubscription(fd)
    setPending(false)
    if ('error' in res && res.error) {
      setMsg(res.error)
      toast.error(res.error)
    } else {
      setMsg(null)
      toast.success(
        editing ? 'Suscripción actualizada' : 'Suscripción agregada',
      )
      onDone?.()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-6">
      {/* Monto mensual con teclado numérico nativo */}
      <div className="flex items-center justify-center gap-1.5 pt-6">
        <span className="text-2xl font-bold text-(--muted-foreground)">$</span>
        <input
          value={amount}
          onChange={(e) => {
            setMsg(null)
            const next = sanitizeAmount(e.target.value)
            if (next !== null) setAmount(next)
          }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          aria-label="Monto mensual"
          className="w-full max-w-56 bg-transparent text-center text-5xl font-extrabold tabular-nums outline-none placeholder:text-(--muted-foreground)/40"
        />
      </div>
      <p className="text-center text-xs font-medium text-(--muted-foreground)">
        al mes
      </p>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
            submit()
          }
        }}
        placeholder="Spotify, Netflix, gimnasio…"
        maxLength={60}
        aria-label="Nombre"
        className="h-12 text-base"
      />

      {/* Pills: día · cuenta · compartir */}
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
        <DayPill day={day} onPick={setDay} />
        <button
          type="button"
          onClick={() => setAccOpen(true)}
          className="flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold">
          <Wallet className="size-3.5" />
          <span className="truncate">{accountName}</span>
        </button>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold',
            shared
              ? 'border-transparent bg-(--foreground) text-(--background)'
              : 'border-(--border) bg-(--muted)/60',
          )}>
          <Users className="size-3.5" /> {shareLabel}
        </button>
      </div>

      <Dialog open={accOpen} onOpenChange={setAccOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cuenta de cargo</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {accountOptions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAccountId(a.id)
                    setAccOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)',
                    accountId === a.id && 'bg-(--muted)',
                  )}>
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

      {/* Categorías: slider ~85% + botón fijo al grid */}
      <div className="flex items-center gap-2">
        <div
          ref={sliderRef}
          className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
          {sliderCats.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCategory(c.code)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold',
                category === c.code
                  ? 'border-transparent bg-(--foreground) text-(--background)'
                  : 'border-(--border) bg-(--muted)/60',
              )}>
              <c.icon className="size-4 shrink-0" style={{ color: c.color }} />{' '}
              {c.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Ver todas las categorías"
          onClick={() => setGridOpen(true)}
          className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-(--border) bg-(--muted)/60 transition active:scale-95">
          <LayoutGrid className="size-4" />
        </button>
      </div>

      <Dialog open={gridOpen} onOpenChange={setGridOpen}>
        <DialogContent className="max-h-[86dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Categorías</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2 pb-2">
            {expenseCats.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => {
                  setCategory(c.code)
                  setGridOpen(false)
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-3xl border p-3 transition active:scale-95',
                  category === c.code
                    ? 'border-(--primary) bg-(--primary)/10'
                    : 'border-transparent bg-(--muted)/60',
                )}>
                <c.icon className="size-7" style={{ color: c.color }} />
                <span className="w-full truncate text-center text-[11px] font-medium">
                  {c.label}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAddingCat((v) => !v)}
              className="flex flex-col items-center justify-center gap-1.5 rounded-3xl border border-dashed border-(--border) p-3 text-(--muted-foreground) transition active:scale-95">
              <Plus className="size-6" />
              <span className="text-[11px] font-medium">Nueva</span>
            </button>
          </div>
          {addingCat && (
            <div className="space-y-3 rounded-3xl border border-(--border) p-3">
              <div className="flex flex-wrap gap-2">
                {ICON_PRESETS.map((iconName) => {
                  const Icon = ICONS[iconName] ?? ICONS.Shapes
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => setNewCatIcon(iconName)}
                      aria-label={iconName}
                      className={cn(
                        'flex size-10 items-center justify-center rounded-2xl border',
                        newCatIcon === iconName
                          ? 'border-(--primary) bg-(--primary)/10'
                          : 'border-(--border)',
                      )}>
                      <Icon className="size-5" style={{ color: newCatColor }} />
                    </button>
                  )
                })}
              </div>
              <div className="grid grid-cols-8 gap-2">
                {CATEGORY_COLORS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setNewCatColor(hex)}
                    aria-label={`Color ${hex}`}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full border-2 ring-1 ring-black/10 ring-inset',
                      newCatColor === hex
                        ? 'border-(--foreground)'
                        : 'border-transparent',
                    )}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Nombre (ej. Gimnasio)"
                  maxLength={30}
                  className="h-11"
                />
                <Button
                  type="button"
                  onClick={saveCustomCat}
                  disabled={savingCat}>
                  {savingCat ? 'Creando…' : 'Crear'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: compartir (referencia visual del reparto) */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compartir suscripción</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-2xl border border-(--border) px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Compartir con mi pareja</p>
              <p className="text-xs text-(--muted-foreground)">
                Cada cargo genera su parte en Pareja
              </p>
            </div>
            <Switch
              checked={shared}
              onCheckedChange={setShared}
              aria-label="Compartir suscripción"
            />
          </div>

          {shared && (
            <>
              <div className="mx-auto grid w-fit grid-cols-2 gap-2 rounded-full bg-(--muted) p-1">
                {(['pct', 'amount'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setShareMode(m)}
                    className={cn(
                      'rounded-full px-5 py-1.5 text-xs font-semibold',
                      shareMode === m
                        ? 'bg-(--card) shadow'
                        : 'text-(--muted-foreground)',
                    )}>
                    {m === 'pct' ? 'Porcentaje' : 'Cantidad'}
                  </button>
                ))}
              </div>
              {shareMode === 'pct' ? (
                <div className="space-y-2 rounded-3xl border border-(--border) p-4">
                  <p className="text-center text-3xl font-extrabold tabular-nums">
                    {sharePct}%
                  </p>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={sharePct}
                    onChange={(e) => setSharePct(Number(e.target.value))}
                    aria-label="Porcentaje que aporta tu pareja"
                    className="w-full accent-(--primary)"
                  />
                  <p className="text-center text-xs text-(--muted-foreground)">
                    Tu pareja aporta <b>{formatMoney(preview)}/mes</b>
                  </p>
                </div>
              ) : (
                <div className="space-y-2 rounded-3xl border border-(--border) p-4">
                  <Input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={shareAmt}
                    onChange={(e) => setShareAmt(e.target.value)}
                    placeholder="Aportación fija ($)"
                    inputMode="decimal"
                  />
                  <p className="text-center text-xs text-(--muted-foreground)">
                    Tu pareja aporta <b>{formatMoney(preview)}/mes</b>
                  </p>
                </div>
              )}

              <Button
                type="button"
                className="w-full"
                onClick={() => setShareOpen(false)}>
                Listo
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      {msg && (
        <p className="text-center text-sm font-medium text-red-500">{msg}</p>
      )}

      {/* Guardar (el monto usa el teclado numérico nativo) */}
      <Button
        type="button"
        onClick={submit}
        disabled={pending}
        className="mt-1 h-12 w-full rounded-2xl text-base">
        {pending
          ? 'Guardando…'
          : editing
            ? 'Guardar cambios'
            : 'Guardar suscripción'}
      </Button>
    </div>
  )
}

function DayPill({
  day,
  onPick,
}: {
  day: number
  onPick: (d: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold">
        <Repeat className="size-3.5" /> Día {day}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Día de cobro</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  onPick(d)
                  setOpen(false)
                }}
                className={cn(
                  'flex size-10 items-center justify-center rounded-full border text-sm font-semibold transition active:scale-95',
                  day === d
                    ? 'border-transparent bg-(--foreground) text-(--background)'
                    : 'border-(--border) text-(--muted-foreground)',
                )}>
                {d}
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-(--muted-foreground)">
            Si el mes no tiene ese día, se cobra el último día
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}

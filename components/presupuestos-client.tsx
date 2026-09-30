'use client'

import { useState } from 'react'

import {
  ArrowDownRight,
  ArrowUpRight,
  Copy,
  HandCoins,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  addBudgetItem,
  copyPreviousMonth,
  deleteBudgetItem,
  deleteCategoryLimit,
  getBudgetMonth,
  setBaseIncome,
  setCategoryLimit,
} from '@/lib/budget-actions'
import type { BudgetPageData } from '@/lib/budgets'
import { lookupCategory } from '@/lib/categories'
import { formatMoney } from '@/lib/utils'

type MonthOpt = { key: string; label: string }
type CatOpt = {
  code: string
  name: string
  iconName: string
  color: string
  kind: 'expense' | 'income' | 'both'
}

type Sheet = null | 'month' | 'income' | 'fixed' | 'limit'

const fieldCls =
  'h-12 rounded-2xl border border-(--border) bg-(--muted)/50 px-4 text-sm outline-none focus:border-(--primary)'

function Bar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-(--muted)">
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
          background: color,
        }}
      />
    </div>
  )
}

export function PresupuestosClient({
  initialMonth,
  initialData,
  months,
  cats,
  accountOpts,
}: {
  initialMonth: string
  initialData: BudgetPageData
  months: MonthOpt[]
  cats: CatOpt[]
  accountOpts: { id: string; name: string }[]
}) {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [pending, setPending] = useState(false)
  const [fixedAccount, setFixedAccount] = useState('')
  const [limitCat, setLimitCat] = useState('')
  // El mes vive en el cliente (sin navegar): cambiar de periodo pide los
  // datos por server action. Evita fricción con el historial del Dialog.
  const [month, setMonth] = useState(initialMonth)
  const [data, setData] = useState<BudgetPageData>(initialData)
  const [loadingMonth, setLoadingMonth] = useState(false)

  const { view, items, limits } = data
  const monthLabel = months.find((m) => m.key === month)?.label ?? month
  const isEmpty =
    view.baseIncome === 0 &&
    items.length === 0 &&
    limits.length === 0 &&
    view.committedTotal === 0

  const status =
    view.available < 0
      ? {
          label: 'En riesgo',
          cls: 'bg-red-500/15 text-red-500',
          bar: '#ef4444',
        }
      : view.spentRatio >= 0.8
        ? {
            label: 'Ajustado',
            cls: 'bg-amber-500/15 text-amber-600',
            bar: '#f59e0b',
          }
        : {
            label: 'Sano',
            cls: 'bg-emerald-500/15 text-emerald-600',
            bar: '#10b981',
          }

  function close() {
    setSheet(null)
  }

  /** Relee el mes actual tras una mutación (los revalidate no pintan solos). */
  async function refresh(target: string) {
    const res = await getBudgetMonth(target)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    if ('ok' in res && res.ok) setData(res.data)
  }

  async function selectMonth(key: string) {
    close()
    if (key === month || loadingMonth) return
    setMonth(key)
    setLoadingMonth(true)
    await refresh(key)
    setLoadingMonth(false)
  }

  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    fn: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>,
  ) {
    e.preventDefault()
    setPending(true)
    const res = await fn(new FormData(e.currentTarget))
    setPending(false)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Guardado')
    close()
    await refresh(month)
  }

  async function onDeleteItem(id: string) {
    if (!confirm('¿Eliminar este fijo?')) return
    const res = await deleteBudgetItem(id)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Eliminado')
      await refresh(month)
    }
  }

  async function onDeleteLimit(category: string) {
    if (!confirm('¿Quitar este límite?')) return
    const res = await deleteCategoryLimit(month, category)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Eliminado')
      await refresh(month)
    }
  }

  async function onCopy() {
    const res = await copyPreviousMonth(month)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Mes copiado')
      await refresh(month)
    }
  }

  // Límites con gasto pero sin tope definido van al final (sin barra de tope).
  const spentNoLimit = view.categories.filter((c) => c.limit == null)

  return (
    <div className={`space-y-4 px-5 pt-4 ${loadingMonth ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setSheet('month')}
          className="rounded-full bg-(--muted) px-4 py-1.5 text-xs font-semibold capitalize">
          {monthLabel} ▾
        </button>
        {loadingMonth && (
          <span className="animate-pulse text-[11px] font-semibold text-(--muted-foreground)">
            Cargando…
          </span>
        )}
      </div>

      {isEmpty && (
        <Card>
          <CardContent className="space-y-2 pt-5 text-center">
            <PiggyBank className="mx-auto size-8 text-(--primary)" />
            <p className="text-sm font-bold">Aún no hay presupuesto este mes</p>
            <p className="text-xs text-(--muted-foreground)">
              Define tu ingreso base o copia el mes anterior para empezar.
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <Button size="sm" onClick={() => setSheet('income')}>
                Definir ingreso
              </Button>
              <Button size="sm" variant="outline" onClick={onCopy}>
                <Copy className="size-4" /> Copiar anterior
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero: ingreso vs comprometido vs disponible */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-(--muted-foreground)">
              Disponible
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>
              {status.label}
            </span>
          </div>
          <p
            className={`text-3xl font-extrabold tracking-tight ${view.available < 0 ? 'text-red-500' : ''}`}>
            {formatMoney(view.available)}
          </p>
          <Bar ratio={view.spentRatio} color={status.bar} />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => setSheet('income')}
              className="rounded-2xl bg-(--muted)/60 p-3 text-left">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-(--muted-foreground)">
                <ArrowUpRight className="size-3.5 text-emerald-500" /> Ingreso
                <Pencil className="size-3 opacity-60" />
              </p>
              <p className="text-base font-extrabold">
                {formatMoney(view.incomeTotal)}
              </p>
              <p className="text-[11px] text-(--muted-foreground)">
                Monto manual del mes
              </p>
            </button>
            <div className="rounded-2xl bg-(--muted)/60 p-3">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-(--muted-foreground)">
                <ArrowDownRight className="size-3.5 text-red-400" />{' '}
                Comprometido
              </p>
              <p className="text-base font-extrabold">
                {formatMoney(view.committedTotal)}
              </p>
              <p className="text-[11px] text-(--muted-foreground)">
                {view.incomeTotal > 0
                  ? `${Math.round(view.spentRatio * 100)}% del ingreso`
                  : 'Sin ingreso base'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comprometido por cuenta */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-(--primary)" /> Comprometido por
            cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {view.accounts.length === 0 && (
            <p className="text-sm text-(--muted-foreground)">
              Sin cuentas visibles.
            </p>
          )}
          {view.accounts.map((a) => (
            <div
              key={a.accountId}
              className="rounded-2xl bg-(--muted)/60 p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-bold">{a.accountName}</p>
                <p className="shrink-0 text-base font-extrabold">
                  {formatMoney(a.total)}
                </p>
              </div>
              {a.details.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-(--muted-foreground)">
                  {a.details.slice(0, 5).map((d, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">· {d.label}</span>
                      <span className="shrink-0 font-semibold">
                        {formatMoney(d.amount)}
                      </span>
                    </li>
                  ))}
                  {a.details.length > 5 && (
                    <li className="font-semibold">
                      +{a.details.length - 5} más…
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-(--muted-foreground)">
                  Nada comprometido este mes.
                </p>
              )}
            </div>
          ))}
          {view.manualGeneral > 0 && (
            <div className="rounded-2xl bg-(--muted)/60 p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold">Fijos generales</p>
                <p className="text-base font-extrabold">
                  {formatMoney(view.manualGeneral)}
                </p>
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-(--muted-foreground)">
                {view.manualGeneralDetails.map((d, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">· {d.label}</span>
                    <span className="shrink-0 font-semibold">
                      {formatMoney(d.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pareja */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="size-4 text-(--primary)" /> En pareja
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="flex items-center justify-between rounded-2xl bg-(--muted)/60 p-3.5">
            <div>
              <p className="text-sm font-bold">Debo aportar</p>
              <p className="text-[11px] text-(--muted-foreground)">
                Suma al comprometido
              </p>
            </div>
            <p className="text-lg font-extrabold">
              {formatMoney(view.partnerOwed)}
            </p>
          </div>
          {view.partnerOwedDetails.length > 0 && (
            <ul className="space-y-0.5 px-1 text-xs text-(--muted-foreground)">
              {view.partnerOwedDetails.map((d, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">· {d.concept}</span>
                  <span className="shrink-0 font-semibold">
                    {formatMoney(d.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view.partnerDueToMe > 0 && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-(--muted-foreground)">
              <Users className="size-3.5" /> Me deben{' '}
              <b>{formatMoney(view.partnerDueToMe)}</b> (no resta, es
              informativo)
            </p>
          )}
          {view.partnerOwed === 0 && view.partnerDueToMe === 0 && (
            <p className="text-sm text-(--muted-foreground)">
              Nada que liquidar este mes. 🎉
            </p>
          )}
        </CardContent>
      </Card>

      {/* Categorías */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Límites por categoría</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSheet('limit')}>
              <Plus className="size-4" /> Límite
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {limits.length === 0 && spentNoLimit.length === 0 && (
            <p className="text-sm text-(--muted-foreground)">
              Sin gasto registrado ni límites este mes.
            </p>
          )}
          {limits.map((l) => {
            const ratio = l.limit > 0 ? l.used / l.limit : 0
            const over = ratio > 1
            return (
              <div
                key={l.category}
                className="rounded-2xl bg-(--muted)/60 p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-bold">{l.label}</p>
                  <button
                    onClick={() => onDeleteLimit(l.category)}
                    className="shrink-0 rounded-full p-1.5 text-(--muted-foreground) hover:bg-(--background)"
                    aria-label={`Quitar límite ${l.label}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                <p className="text-xs text-(--muted-foreground)">
                  <b className={over ? 'text-red-500' : ''}>
                    {formatMoney(l.used)}
                  </b>{' '}
                  de {formatMoney(l.limit)}
                  {over && ' · te pasaste'}
                </p>
                <div className="mt-1.5">
                  <Bar
                    ratio={ratio}
                    color={
                      over ? '#ef4444' : ratio >= 0.8 ? '#f59e0b' : l.color
                    }
                  />
                </div>
              </div>
            )
          })}
          {spentNoLimit.length > 0 && (
            <div className="px-1 pt-1">
              <p className="pb-1.5 text-[11px] font-semibold text-(--muted-foreground)">
                Gasto sin límite
              </p>
              <ul className="space-y-1 text-xs">
                {spentNoLimit.map((c) => (
                  <li key={c.category} className="flex justify-between gap-2">
                    <span className="truncate text-(--muted-foreground)">
                      {lookupCategory(c.category, cats).label}
                    </span>
                    <span className="font-bold">{formatMoney(c.used)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fijos del mes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Fijos del mes</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSheet('fixed')}>
              <Plus className="size-4" /> Fijo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && (
            <p className="text-sm text-(--muted-foreground)">
              Ej. renta, colegiatura, abono extra. Suman al comprometido.
            </p>
          )}
          {items.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-2 rounded-2xl bg-(--muted)/60 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{it.label}</p>
                <p className="truncate text-[11px] text-(--muted-foreground)">
                  {it.accountName ?? 'General'}
                </p>
              </div>
              <p className="shrink-0 text-sm font-extrabold">
                {formatMoney(it.amount)}
              </p>
              <button
                onClick={() => onDeleteItem(it.id)}
                className="shrink-0 rounded-full p-1.5 text-(--muted-foreground) hover:bg-(--background)"
                aria-label={`Eliminar ${it.label}`}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={sheet !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {sheet === 'month' && 'Seleccionar mes'}
              {sheet === 'income' && 'Ingreso base del mes'}
              {sheet === 'fixed' && 'Agregar fijo'}
              {sheet === 'limit' && 'Límite por categoría'}
            </DialogTitle>
          </DialogHeader>

          {sheet === 'month' && (
            <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
              {months.map((m) => (
                <li key={m.key}>
                  <button
                    onClick={() => selectMonth(m.key)}
                    className={`block w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold capitalize hover:bg-(--muted) ${
                      m.key === month ? 'bg-(--muted)' : ''
                    }`}>
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {sheet === 'income' && (
            <form
              onSubmit={(e) => submit(e, setBaseIncome)}
              className="space-y-3">
              <input type="hidden" name="month" value={month} />
              <div className="space-y-1.5">
                <Label htmlFor="baseIncome">
                  ¿Cuánto ganas al mes? (ej. 12564)
                </Label>
                <Input
                  id="baseIncome"
                  name="baseIncome"
                  inputMode="decimal"
                  defaultValue={
                    view.baseIncome > 0 ? String(view.baseIncome) : ''
                  }
                  placeholder="0.00"
                  className={fieldCls}
                />
                <p className="text-[11px] text-(--muted-foreground)">
                  Es manual: los movimientos de Actividad no lo modifican.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Guardando…' : 'Guardar'}
              </Button>
            </form>
          )}

          {sheet === 'fixed' && (
            <form
              onSubmit={(e) => submit(e, addBudgetItem)}
              className="space-y-3">
              <input type="hidden" name="month" value={month} />
              <div className="space-y-1.5">
                <Label htmlFor="label">Concepto</Label>
                <Input
                  id="label"
                  name="label"
                  placeholder="Renta"
                  className={fieldCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">Monto</Label>
                <Input
                  id="amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  className={fieldCls}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accountId">Cuenta (opcional)</Label>
                <select
                  id="accountId"
                  name="accountId"
                  value={fixedAccount}
                  onChange={(e) => setFixedAccount(e.target.value)}
                  className={`${fieldCls} w-full`}>
                  <option value="">General (no atado a tarjeta)</option>
                  {accountOpts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Guardando…' : 'Agregar'}
              </Button>
            </form>
          )}

          {sheet === 'limit' && (
            <form
              onSubmit={(e) => submit(e, setCategoryLimit)}
              className="space-y-3">
              <input type="hidden" name="month" value={month} />
              <div className="space-y-1.5">
                <Label htmlFor="category">Categoría</Label>
                <select
                  id="category"
                  name="category"
                  value={limitCat}
                  onChange={(e) => setLimitCat(e.target.value)}
                  className={`${fieldCls} w-full`}>
                  <option value="">Elige…</option>
                  {cats.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="limit">Límite</Label>
                <Input
                  id="limit"
                  name="limit"
                  inputMode="decimal"
                  placeholder="0.00"
                  className={fieldCls}
                />
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Guardando…' : 'Guardar límite'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

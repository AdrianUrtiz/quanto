'use client'

import { useMemo, useState } from 'react'

import { Check, HandCoins } from 'lucide-react'

import type { MonthOpt } from '@/components/activity-client'
import {
  type CreditStatementView,
  CreditStatements,
} from '@/components/credit-statements'
import { DonutChart } from '@/components/donut-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { settleMonth } from '@/lib/calculations'
import type { CatalogRow } from '@/lib/catalog'
import { lookupCategory } from '@/lib/categories'
import { formatMoney } from '@/lib/utils'

export type ResumenMineTx = {
  id: string
  type: 'EXPENSE' | 'INCOME'
  category: string
  amount: number
  date: string // ISO
  accountName: string
}

export type ResumenInvolvedTx = {
  id: string
  concept: string
  amount: number
  installments: number
  date: string // ISO
  isShared: boolean
  createdById: string
  creatorName: string
  shares: {
    id: string
    debtorId: string
    debtorName: string
    sharePct: number
    monthlyAmount: number
  }[]
}

type Kind = 'gastos' | 'ingresos' | 'todos'
type Range = 'mensual' | 'semanal' | 'trimestral' | 'seis' | 'anio' | 'todo'
type Sheet = null | 'kind' | 'range' | 'month' | 'account' | 'category'

const KINDS: { value: Kind; label: string }[] = [
  { value: 'gastos', label: 'Gastos' },
  { value: 'ingresos', label: 'Ingresos' },
  { value: 'todos', label: 'Toda la actividad' },
]

const RANGES: { value: Range; label: string }[] = [
  { value: 'mensual', label: 'Mensual' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'seis', label: 'Últimos 6 meses' },
  { value: 'anio', label: 'Todo el año' },
  { value: 'todo', label: 'Todo el tiempo' },
]

const RANGE_DESC: Record<Range, string> = {
  mensual: '',
  semanal: 'Por día · últimos 7 días',
  trimestral: `Por trimestre · ${new Date().getFullYear()}`,
  seis: 'Por mes · últimos 6 meses',
  anio: `Por mes · ${new Date().getFullYear()}`,
  todo: 'Acumulado por año',
}

function monthKeyOf(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Inicio del rango (el fin siempre es hoy). Null = mes seleccionado. */
function rangeStart(range: Range): Date | null {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (range) {
    case 'mensual':
      return null
    case 'semanal':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6)
    case 'trimestral':
      return new Date(now.getFullYear(), 0, 1)
    case 'seis':
      return new Date(now.getFullYear(), now.getMonth() - 5, 1)
    case 'anio':
      return new Date(now.getFullYear(), 0, 1)
    case 'todo':
      return new Date(2000, 0, 1)
  }
}

export function ResumenClient({
  months,
  mine,
  involved,
  confirmed,
  cats,
  statements = [],
}: {
  months: MonthOpt[]
  mine: ResumenMineTx[]
  involved: ResumenInvolvedTx[]
  confirmed: { key: string; amount: number }[]
  cats: CatalogRow[]
  statements?: CreditStatementView[]
}) {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [month, setMonth] = useState(
    months[0]?.key ?? monthKeyOf(new Date().toISOString()),
  )
  const [kind, setKind] = useState<Kind>('gastos')
  const [range, setRange] = useState<Range>('mensual')
  const [account, setAccount] = useState('todas')
  const [category, setCategory] = useState('todas')

  const monthLabel = months.find((m) => m.key === month)?.label ?? month
  const start = rangeStart(range)

  // Suma según el tipo activo (igual que Actividad: el total siempre es del tipo).
  const inKind = (t: ResumenMineTx) =>
    kind === 'ingresos' ? t.type === 'INCOME' : t.type === 'EXPENSE'

  // 1) Rango temporal
  const rangeTxs = useMemo(() => {
    if (range === 'mensual')
      return mine.filter((t) => monthKeyOf(t.date) === month)
    const end = new Date()
    return mine.filter((t) => {
      const d = new Date(t.date)
      return d >= start! && d <= end
    })
  }, [mine, range, month, start])

  // 2) Filtros restantes → donut
  const { total, byCategory } = useMemo(() => {
    const rows = rangeTxs.filter((t) => {
      if (!inKind(t)) return false
      if (account !== 'todas' && t.accountName !== account) return false
      if (category !== 'todas' && t.category !== category) return false
      return true
    })
    const map = new Map<string, number>()
    for (const t of rows)
      map.set(t.category, (map.get(t.category) ?? 0) + t.amount)
    return {
      total: rows.reduce((a, t) => a + t.amount, 0),
      byCategory: [...map.entries()]
        .map(([code, value]) => {
          const c = lookupCategory(code, cats)
          return { label: c.label, value, color: c.color }
        })
        .sort((a, b) => b.value - a.value),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind, account, category, cats])

  // Opciones con totales (respetan el tipo activo).
  const accountOpts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of rangeTxs) {
      if (!inKind(t)) continue
      map.set(t.accountName, (map.get(t.accountName) ?? 0) + t.amount)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind])

  const categoryOpts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of rangeTxs) {
      if (!inKind(t)) continue
      map.set(t.category, (map.get(t.category) ?? 0) + t.amount)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind])

  // Liquidación entre pareja: siempre del mes seleccionado.
  const settlement = useMemo(
    () =>
      settleMonth(
        involved.map((t) => ({ ...t, date: new Date(t.date) })),
        month,
        new Map(confirmed.map((c) => [c.key, c.amount])),
      ),
    [involved, month, confirmed],
  )

  const kindLabel = KINDS.find((k) => k.value === kind)!.label
  const rangeLabel = RANGES.find((r) => r.value === range)!.label

  function close() {
    setSheet(null)
  }

  return (
    <div className="space-y-4 px-5 pt-4">
      {range === 'mensual' ? (
        <div className="flex items-center justify-center">
          <button
            onClick={() => setSheet('month')}
            className="rounded-full bg-(--muted) px-4 py-1.5 text-xs font-semibold capitalize">
            {monthLabel} ▾
          </button>
        </div>
      ) : (
        <p className="text-center text-xs font-semibold text-(--muted-foreground)">
          {RANGE_DESC[range]}
        </p>
      )}

      <Card>
        <CardContent className="pt-5">
          <DonutChart total={total} slices={byCategory} />
        </CardContent>
      </Card>

      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <FilterPill
          label={kindLabel}
          active={kind !== 'gastos'}
          onClick={() => setSheet('kind')}
        />
        <FilterPill
          label={rangeLabel}
          active={range !== 'mensual'}
          onClick={() => setSheet('range')}
        />
        <FilterPill
          label={account === 'todas' ? 'Todas las cuentas' : account}
          active={account !== 'todas'}
          onClick={() => setSheet('account')}
        />
        <FilterPill
          label={
            category === 'todas'
              ? 'Todas las categorías'
              : lookupCategory(category, cats).label
          }
          active={category !== 'todas'}
          onClick={() => setSheet('category')}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="size-4 text-(--primary)" /> Cuentas por
            liquidar entre pareja
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settlement.length === 0 && (
            <p className="text-sm text-(--muted-foreground)">
              Nada que liquidar este mes. 🎉
            </p>
          )}
          {settlement.map((s) => (
            <div
              key={`${s.debtorId}-${s.creditorId}`}
              className="rounded-2xl bg-(--muted)/60 p-3.5">
              <p className="text-sm">
                <b>{s.debtorName}</b> aporta a <b>{s.creditorName}</b>
              </p>
              <p className="text-xl font-extrabold">{formatMoney(s.amount)}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-(--muted-foreground)">
                {s.details.map((d, i) => (
                  <li key={i}>
                    · {d.concept} — {formatMoney(d.monthly)}/mes (
                    {d.installment})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      {statements.length > 0 && <CreditStatements statements={statements} />}

      <Dialog open={sheet !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {sheet === 'kind' && 'Tipo de movimiento'}
              {sheet === 'range' && 'Periodo'}
              {sheet === 'month' && 'Seleccionar mes'}
              {sheet === 'account' && 'Filtrar por cuenta'}
              {sheet === 'category' && 'Filtrar por categoría'}
            </DialogTitle>
          </DialogHeader>

          {sheet === 'kind' && (
            <Options
              items={KINDS.map((k) => ({ value: k.value, label: k.label }))}
              value={kind}
              onPick={(v) => {
                setKind(v as Kind)
                close()
              }}
            />
          )}
          {sheet === 'range' && (
            <Options
              items={RANGES.map((r) => ({ value: r.value, label: r.label }))}
              value={range}
              onPick={(v) => {
                setRange(v as Range)
                close()
              }}
            />
          )}
          {sheet === 'month' && (
            <Options
              items={months.map((m) => ({
                value: m.key,
                label: m.label,
                total: m.total,
                cap: true,
              }))}
              value={month}
              onPick={(v) => {
                setMonth(v)
                close()
              }}
            />
          )}
          {sheet === 'account' && (
            <Options
              items={[
                { value: 'todas', label: 'Todas las cuentas' },
                ...accountOpts.map(([name, total]) => ({
                  value: name,
                  label: name,
                  total,
                })),
              ]}
              value={account}
              onPick={(v) => {
                setAccount(v)
                close()
              }}
            />
          )}
          {sheet === 'category' && (
            <Options
              items={[
                { value: 'todas', label: 'Todas las categorías' },
                ...categoryOpts.map(([cat, total]) => ({
                  value: cat,
                  label: lookupCategory(cat, cats).label,
                  total,
                })),
              ]}
              value={category}
              onPick={(v) => {
                setCategory(v)
                close()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`max-w-55 shrink-0 truncate rounded-full border px-4 py-2 text-xs font-semibold transition ${
        active
          ? 'border-transparent bg-(--foreground) text-(--background)'
          : 'border-(--border) bg-(--card) text-(--muted-foreground)'
      }`}>
      {label}
    </button>
  )
}

function Options({
  items,
  value,
  onPick,
}: {
  items: { value: string; label: string; total?: number; cap?: boolean }[]
  value: string
  onPick: (v: string) => void
}) {
  return (
    <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
      {items.map((it) => (
        <li key={it.value}>
          <button
            onClick={() => onPick(it.value)}
            className={`flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted) ${
              it.value === value ? 'bg-(--muted)' : ''
            }`}>
            <span
              className={`flex-1 text-sm font-semibold ${it.cap ? 'capitalize' : ''}`}>
              {it.label}
            </span>
            {it.total !== undefined && (
              <span className="text-sm font-bold">{formatMoney(it.total)}</span>
            )}
            {it.value === value && (
              <Check className="size-4 text-(--primary)" />
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

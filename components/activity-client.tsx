'use client'

import { useMemo, useState } from 'react'

import { Check, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { ActivityChart } from '@/components/activity-chart'
import { CardPayReminders } from '@/components/card-pay-reminders'
import {
  type ExpiryAccount,
  ExpiryReminders,
} from '@/components/expiry-reminders'
import { PartnerPayReminders } from '@/components/partner-pay-reminders'
import { TransactionRow, type TxRow } from '@/components/transaction-list'
import { TransactionSwipeRow } from '@/components/transaction-swipe-row'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import {
  type ActivityKind,
  type ActivityRange,
  useActivityFilters,
} from '@/lib/activity-filters'
import type { CardPayCandidate } from '@/lib/card-pay'
import type { CatalogRow } from '@/lib/catalog'
import { lookupCategory } from '@/lib/categories'
import { useCuentasFilters } from '@/lib/cuentas-filters'
import type { PartnerPayItem } from '@/lib/partner-pay'
import { useStatementFilters } from '@/lib/resumen-filters'
import { formatMoney } from '@/lib/utils'
import {
  WD_ES,
  daysInWallMonth,
  endOfWallDay,
  fmtMonthShort,
  mexicoMonthKey,
  monthKeyOfWall,
  rangeStartWall,
  wallNow,
} from '@/lib/walltime'

export type MonthOpt = { key: string; label: string; total: number }

type Sheet = null | 'kind' | 'range' | 'month' | 'account' | 'category'

const RANGES: { value: ActivityRange; label: string }[] = [
  { value: 'mensual', label: 'Mensual' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'seis', label: 'Últimos 6 meses' },
  { value: 'anio', label: 'Todo el año' },
  { value: 'todo', label: 'Todo el tiempo' },
]

const KINDS: { value: ActivityKind; label: string }[] = [
  { value: 'todos', label: 'Toda la actividad' },
  { value: 'gastos', label: 'Gastos' },
  { value: 'ingresos', label: 'Ingresos' },
]

const RANGE_DESC: Record<ActivityRange, string> = {
  mensual: '',
  semanal: 'Por día · últimos 7 días',
  trimestral: `Por trimestre · ${new Date().getFullYear()}`,
  seis: 'Por mes · últimos 6 meses',
  anio: `Por mes · ${new Date().getFullYear()}`,
  todo: 'Acumulado por año',
}

function keyOf(iso: string) {
  // Hora-muro (ver lib/walltime.ts): el ISO de la BD ya viene etiquetado
  // UTC = día real en México.
  return monthKeyOfWall(new Date(iso))
}

function dayKey(d: Date) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
}

function shortMonth(d: Date) {
  const s = fmtMonthShort(d)
  return d.getUTCFullYear() === Number(mexicoMonthKey().slice(0, 4))
    ? s
    : `${s} ${String(d.getUTCFullYear()).slice(2)}`
}

/** Inicio del rango (el fin siempre es hoy). Null = mes seleccionado. */
function rangeStart(range: ActivityRange): Date | null {
  return rangeStartWall(range, wallNow())
}

export function ActivityClient({
  txs,
  months,
  cats,
  expiryAccounts = [],
  filterAccounts = [],
  partnerDebtItems = [],
  partnerSums = [],
  cardPayItems = [],
}: {
  txs: TxRow[]
  months: MonthOpt[]
  cats: CatalogRow[]
  expiryAccounts?: ExpiryAccount[]
  /** Cuentas propias no ocultas para el filtro (débito y crédito). */
  filterAccounts?: { id: string; name: string; type: string }[]
  /** Lo que le debo a mi pareja (origen Cuentas > Pareja). */
  partnerDebtItems?: PartnerPayItem[]
  partnerSums?: { key: string; confirmed: number; pending: number }[]
  /** Cierre de MIS tarjetas (propietario): pago para no generar intereses. */
  cardPayItems?: CardPayCandidate[]
}) {
  const router = useRouter()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const storedMonth = useActivityFilters((s) => s.month)
  const kind = useActivityFilters((s) => s.kind)
  const range = useActivityFilters((s) => s.range)
  const account = useActivityFilters((s) => s.account)
  const category = useActivityFilters((s) => s.category)
  const setMonth = useActivityFilters((s) => s.setMonth)
  const setKind = useActivityFilters((s) => s.setKind)
  const setRange = useActivityFilters((s) => s.setRange)
  const setAccount = useActivityFilters((s) => s.setAccount)
  const setCategory = useActivityFilters((s) => s.setCategory)
  const setPartnerMonth = useCuentasFilters((s) => s.setPartnerMonth)
  const setCuentasTab = useCuentasFilters((s) => s.setTab)
  const setStmtCard = useStatementFilters((s) => s.setCardId)
  const setStmtPeriod = useStatementFilters((s) => s.setPeriod)
  const [q, setQ] = useState('')

  // Sumas CONFIRMED/PENDING por línea para suprimir avisos ya pagados.
  const partnerPaySumsMap = useMemo(
    () =>
      new Map(
        partnerSums.map((s) => [
          s.key,
          { confirmed: s.confirmed, pending: s.pending },
        ]),
      ),
    [partnerSums],
  )

  // El mes persistido puede no existir (p. ej. datos nuevos): se usa el más
  // reciente sin sobrescribir el store hasta que el usuario elija otro.
  const month =
    months.some((m) => m.key === storedMonth) && storedMonth
      ? storedMonth
      : (months[0]?.key ?? storedMonth)

  const monthLabel = months.find((m) => m.key === month)?.label ?? month
  const start = rangeStart(range)

  // 1) Rango temporal (el fin es hoy completo: los movimientos de hoy
  // con hora posterior a este momento también cuentan)
  const rangeTxs = useMemo(() => {
    if (range === 'mensual') return txs.filter((t) => keyOf(t.date) === month)
    const end = endOfWallDay(wallNow())
    return txs.filter((t) => {
      const d = new Date(t.date)
      return d >= start! && d <= end
    })
  }, [txs, range, month, start])

  // Suma según el tipo activo (para totales de cuentas/categorías).
  const inKind = (t: TxRow) =>
    kind === 'ingresos' ? t.type === 'INCOME' : t.type === 'EXPENSE'

  // 2) Filtros restantes (un traspaso matchea por origen o destino)
  const filtered = useMemo(() => {
    return rangeTxs.filter((t) => {
      if (kind !== 'todos' && !inKind(t)) return false
      if (
        account !== 'todas' &&
        t.accountName !== account &&
        t.transferToAccountName !== account
      )
        return false
      if (category !== 'todas' && t.category !== category) return false
      if (
        q &&
        !`${t.concept} ${t.category}`.toLowerCase().includes(q.toLowerCase())
      )
        return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind, account, category, q])

  const shownTotal = useMemo(
    () => filtered.filter(inKind).reduce((a, t) => a + t.amount, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kind],
  )

  // 3) Buckets del gráfico según la granularidad del periodo:
  //    mensual → días · semanal → 7 días · trimestral → T1-T4 del año ·
  //    seis → 6 meses · anio → 12 meses · todo → por año.
  // Todo en hora-muro (getters UTC): los ISO de la BD ya vienen etiquetados.
  const { buckets, todayIndex } = useMemo(() => {
    const onlyExpenses = rangeTxs.filter((t) => t.type === 'EXPENSE')
    const now = wallNow()

    if (range === 'mensual') {
      const [y, m] = month.split('-').map(Number)
      const dim = daysInWallMonth(y, m - 1)
      const arr = Array.from({ length: dim }, (_, i) => ({
        label: `${i + 1}`,
        total: 0,
      }))
      for (const t of onlyExpenses) {
        const d = new Date(t.date).getUTCDate()
        if (d >= 1 && d <= dim) arr[d - 1].total += t.amount
      }
      const isCur = monthKeyOfWall(now) === month
      return {
        buckets: arr,
        todayIndex: isCur ? now.getUTCDate() - 1 : null,
      }
    }

    if (range === 'semanal') {
      const days: { label: string; total: number }[] = []
      const idxByDay = new Map<string, number>()
      const cur = new Date(start!)
      const today = now
      while (cur <= today) {
        idxByDay.set(dayKey(cur), days.length)
        days.push({
          label: `${WD_ES[cur.getUTCDay()]} ${cur.getUTCDate()}`,
          total: 0,
        })
        cur.setUTCDate(cur.getUTCDate() + 1)
      }
      for (const t of onlyExpenses) {
        const i = idxByDay.get(dayKey(new Date(t.date)))
        if (i !== undefined) days[i].total += t.amount
      }
      return { buckets: days, todayIndex: days.length - 1 }
    }

    if (range === 'trimestral') {
      const y = now.getUTCFullYear()
      const arr = ['T1', 'T2', 'T3', 'T4'].map((label) => ({
        label,
        total: 0,
      }))
      for (const t of onlyExpenses) {
        const d = new Date(t.date)
        if (d.getUTCFullYear() !== y || d > now) continue
        arr[Math.floor(d.getUTCMonth() / 3)].total += t.amount
      }
      return { buckets: arr, todayIndex: Math.floor(now.getUTCMonth() / 3) }
    }

    if (range === 'seis') {
      const arr: { label: string; total: number; y: number; m: number }[] = []
      for (let i = 5; i >= 0; i--) {
        const t = now.getUTCMonth() - i
        const y = now.getUTCFullYear() + Math.floor(t / 12)
        const m = ((t % 12) + 12) % 12
        const d = new Date(Date.UTC(y, m, 1))
        arr.push({ label: shortMonth(d), total: 0, y, m })
      }
      for (const t of onlyExpenses) {
        const d = new Date(t.date)
        const b = arr.find(
          (b) => b.y === d.getUTCFullYear() && b.m === d.getUTCMonth(),
        )
        if (b) b.total += t.amount
      }
      return { buckets: arr, todayIndex: arr.length - 1 }
    }

    if (range === 'anio') {
      const y = now.getUTCFullYear()
      const arr = Array.from({ length: 12 }, (_, m) => ({
        label: shortMonth(new Date(Date.UTC(y, m, 1))),
        total: 0,
      }))
      for (const t of onlyExpenses) {
        const d = new Date(t.date)
        if (d.getUTCFullYear() !== y || d > now) continue
        arr[d.getUTCMonth()].total += t.amount
      }
      return { buckets: arr, todayIndex: now.getUTCMonth() }
    }

    // todo: acumulado por año
    const years = new Map<number, number>()
    for (const t of onlyExpenses) {
      const y = new Date(t.date).getUTCFullYear()
      years.set(y, (years.get(y) ?? 0) + t.amount)
    }
    const keys = [...years.keys()].sort((a, b) => a - b)
    const minY = keys.length ? keys[0] : now.getUTCFullYear()
    const arr: { label: string; total: number }[] = []
    for (let y = minY; y <= now.getUTCFullYear(); y++)
      arr.push({ label: `${y}`, total: years.get(y) ?? 0 })
    return { buckets: arr, todayIndex: arr.length - 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, range, month])

  // Opciones de cuenta para el diálogo de edición (solo las mías, ya filtradas;
  // las filas de pareja son solo lectura y no aportan cuentas).
  const accountOptionsAll = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>()
    for (const t of txs)
      if (!t.partnerShare)
        map.set(t.accountId, { name: t.accountName, type: t.accountType })
    return [...map.entries()].map(([id, v]) => ({
      id,
      name: v.name,
      type: v.type,
    }))
  }, [txs])

  // Opciones: todas las cuentas propias no ocultas (débito y crédito),
  // ordenadas A–Z y sin contadores. Un traspaso involucra dos cuentas:
  // aparece al filtrar por cualquiera de las dos (sin duplicarse).
  const accountOpts = useMemo(() => {
    return filterAccounts
      .map((a) => a.name)
      .sort((a, b) => a.localeCompare(b, 'es'))
  }, [filterAccounts])

  const categoryOpts = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of rangeTxs) {
      if (!inKind(t)) continue
      map.set(t.category, (map.get(t.category) ?? 0) + t.amount)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind])

  const kindLabel = KINDS.find((k) => k.value === kind)!.label
  const rangeLabel = RANGES.find((r) => r.value === range)!.label

  function close() {
    setSheet(null)
  }

  return (
    <div className="space-y-4 px-5 pt-4">
      <ExpiryReminders accounts={expiryAccounts} />
      <PartnerPayReminders
        debtItems={partnerDebtItems}
        sums={partnerPaySumsMap}
        onPay={(it) => {
          setPartnerMonth(it.dueKey)
          setCuentasTab('pareja')
          router.push('/cuentas')
        }}
      />
      <CardPayReminders
        items={cardPayItems ?? []}
        onPay={(it) => {
          setStmtCard(it.cardId)
          setStmtPeriod(it.cardId, it.periodKey)
          router.push('/resumen')
        }}
      />
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
      <p className="text-center text-5xl font-extrabold tracking-tight">
        {formatMoney(shownTotal)}
      </p>

      <ActivityChart
        key={`${range}-${month}`}
        buckets={buckets}
        todayIndex={todayIndex}
      />

      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-full border border-(--border) bg-(--card) px-4 py-2.5">
          <Search className="size-4 text-(--muted-foreground)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            className="w-full bg-transparent text-sm outline-none placeholder:text-(--muted-foreground)"
          />
        </div>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <FilterPill
            label={kindLabel}
            active={kind !== 'todos'}
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
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
          Sin movimientos en este periodo.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) =>
            t.locked ? (
              <TransactionRow key={t.id} t={t} cats={cats} />
            ) : (
              <TransactionSwipeRow
                key={t.id}
                t={t}
                accountOptions={accountOptionsAll}
                cats={cats}
                open={openRow === t.id}
                onOpenChange={(o) => setOpenRow(o ? t.id : null)}
              />
            ),
          )}
        </ul>
      )}

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
                setKind(v as ActivityKind)
                close()
              }}
            />
          )}
          {sheet === 'range' && (
            <Options
              items={RANGES.map((r) => ({ value: r.value, label: r.label }))}
              value={range}
              onPick={(v) => {
                setRange(v as ActivityRange)
                close()
              }}
            />
          )}
          {sheet === 'month' && (
            <Options
              items={months.map((m) => ({
                value: m.key,
                label: m.label,
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
                ...accountOpts.map((name) => ({
                  value: name,
                  label: name,
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

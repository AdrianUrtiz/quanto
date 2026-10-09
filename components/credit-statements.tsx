'use client'

import { useMemo, useState } from 'react'

import { Check, CreditCard } from 'lucide-react'
import { useRouter } from 'next/navigation'

import type { AccountRow } from '@/components/account-card'
import { AccountMoneySheet } from '@/components/account-money-sheet'
import { BottomSheet } from '@/components/bottom-sheet'
import type { AccountOpt } from '@/components/transaction-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { toCents } from '@/lib/money'
import { useStatementFilters } from '@/lib/resumen-filters'
import { formatMoney } from '@/lib/utils'
import { fmtMonthShort } from '@/lib/walltime'
import { cn } from '@/lib/utils'

export type StatementMoveView = {
  id: string
  date: string // ISO
  concept: string
  kind: 'charge' | 'payment'
  amount: number
  tag: string | null
  /** Eco local creado sin conexión, pendiente de subir a la central. */
  pending?: boolean
}

export type StatementPeriodView = {
  key: string
  label: string // "Octubre de 2026"
  chartLabel: string // "OCT 26"
  start: string // ISO
  end: string // ISO
  dueDate: string | null // ISO
  dueLabel: string | null // "26 de noviembre"
  cutoffLabel: string // "15 de octubre"
  prevDebt: number
  charges: number
  payments: number
  closing: number // pago para no generar intereses
  future: number // MSI aún no exigibles
  moves: StatementMoveView[]
}

export type CreditStatementView = {
  card: {
    id: string
    name: string
    lastFour: string | null
    color: string
    creditLimit: number | null
    statementDay: number | null
    dueDay: number | null
    currentDebt: number
    available: number | null
  }
  debitOpts: AccountOpt[]
  periods: StatementPeriodView[]
  currentKey: string // período vigente a pagar (periods[0] puede ser futuro con MSI)
}

type Sheet = null | 'card' | 'period'

function moveDay(iso: string) {
  // Hora-muro (ver lib/walltime.ts): el ISO ya viene etiquetado UTC.
  const d = new Date(iso)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const mon = fmtMonthShort(d).replace('.', '').toUpperCase()
  return `${day} ${mon}`
}

function cardLabel(card: CreditStatementView['card']) {
  return card.lastFour ? `${card.name} ··${card.lastFour}` : card.name
}

function StatementPanel({
  view,
  period,
  isCurrent,
  onPeriodChange,
}: {
  view: CreditStatementView
  period: StatementPeriodView
  isCurrent: boolean
  onPeriodChange: (key: string) => void
}) {
  const router = useRouter()
  const [payOpen, setPayOpen] = useState(false)
  const { card, periods } = view

  const [nowRef] = useState(() => Date.now())
  const isFuture = new Date(period.start).getTime() > nowRef
  // Ya pagado si el cierre quedó en cero (centavos exactos).
  // El cierre ya descuenta los pagos, así que basta con ver el cierre.
  const paid = toCents(period.closing) <= 0
  const chart = useMemo(() => [...periods].reverse(), [periods])
  const maxCharges = Math.max(1, ...periods.map((p) => p.charges))

  const account: AccountRow = {
    id: card.id,
    name: card.name,
    type: 'CREDIT',
    owner: '',
    ownerId: '',
    balance: card.currentDebt,
    creditLimit: card.creditLimit ?? undefined,
    lastFour: card.lastFour ?? undefined,
    color: card.color,
    isHidden: false,
    position: 0,
    isFavorite: false,
  }

  return (
    <div className="space-y-4">
      {/* Gráfica de cargos por corte */}
      <div className="flex h-28 items-end gap-1.5">
        {chart.map((p) => {
          const active = p.key === period.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriodChange(p.key)}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              title={`${p.label}: ${formatMoney(p.charges, true)}`}>
              <span
                className={cn(
                  'w-full rounded-t-md transition-all',
                  active ? 'bg-(--primary)' : 'bg-(--muted-foreground)/25',
                )}
                style={{
                  height: `${Math.max(6, (p.charges / maxCharges) * 100)}%`,
                }}
              />
              <span
                className={cn(
                  'text-center text-[8px] leading-tight',
                  active
                    ? 'font-bold text-(--foreground)'
                    : 'text-(--muted-foreground)',
                )}>
                {p.chartLabel.split(' ').map((w, i) => (
                  <span key={i} className="block">
                    {w}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>

      {/* Total del período */}
      <div>
        <p className="text-sm font-semibold text-(--primary)">
          {isCurrent
            ? 'Tus gastos actuales en la tarjeta'
            : isFuture
              ? 'Cargos del próximo corte'
              : 'Saldo al corte'}
        </p>
        <p className="text-4xl font-extrabold tracking-tight">
          {formatMoney(period.closing, true)}
        </p>
        <div className="mt-2 space-y-0.5 text-sm">
          {period.dueLabel && (
            <p className="text-(--muted-foreground)">
              Fecha límite de pago ·{' '}
              <b className="font-semibold text-(--foreground)">
                {period.dueLabel}
              </b>
            </p>
          )}
          <p className="text-(--muted-foreground)">
            Fecha de corte ·{' '}
            <b className="font-semibold text-(--foreground)">
              {period.cutoffLabel}
            </b>
          </p>
        </div>
        <dl className="mt-2 space-y-0.5 text-xs text-(--muted-foreground)">
          <div className="flex justify-between">
            <dt>Saldo anterior</dt>
            <dd className="font-semibold text-(--foreground)">
              {formatMoney(period.prevDebt, true)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Cargos del período</dt>
            <dd className="font-semibold text-(--foreground)">
              +{formatMoney(period.charges, true)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Pagos del período</dt>
            <dd className="font-semibold text-emerald-500">
              −{formatMoney(period.payments, true)}
            </dd>
          </div>
          {period.future > 0 && (
            <div className="flex justify-between">
              <dt>MSI aún no exigibles</dt>
              <dd className="font-semibold text-(--foreground)">
                {formatMoney(period.future, true)}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <hr className="border-(--border)" />

      {/* Movimientos */}
      <ul className="space-y-3">
        {period.moves.length === 0 && (
          <p className="py-4 text-center text-sm text-(--muted-foreground)">
            Sin movimientos en este corte.
          </p>
        )}
        {period.moves.map((m) => (
          <li key={m.id} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-xs font-semibold text-(--muted-foreground)">
              {moveDay(m.date)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{m.concept}</span>
              {m.tag && (
                <span className="block text-[11px] text-(--muted-foreground)">
                  {m.tag}
                </span>
              )}
              {m.pending && (
                <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-500">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  Pendiente
                </span>
              )}
            </span>
            <span
              className={cn(
                'shrink-0 text-sm font-semibold',
                m.kind === 'payment' && 'text-emerald-500',
              )}>
              {m.kind === 'payment' ? '−' : ''}
              {formatMoney(m.amount, true)}
            </span>
          </li>
        ))}
      </ul>

      {!isFuture && !paid && (
        <Button
          type="button"
          className="h-12 w-full rounded-full text-base"
          disabled={view.debitOpts.length === 0}
          onClick={() => setPayOpen(true)}>
          Pagar
        </Button>
      )}
      {!isFuture && paid && (
        <p className="rounded-full bg-emerald-500/10 py-2.5 text-center text-sm font-semibold text-emerald-500">
          Periodo pagado
        </p>
      )}

      <BottomSheet open={payOpen} onOpenChange={(o) => !o && setPayOpen(false)}>
        <AccountMoneySheet
          key={period.key}
          account={account}
          sourceOptions={view.debitOpts}
          statementKey={period.key}
          statementLabel={period.label}
          defaultAmount={period.closing > 0 ? period.closing : null}
          onDone={() => {
            setPayOpen(false)
            router.refresh()
          }}
        />
      </BottomSheet>
    </div>
  )
}

export function CreditStatements({
  statements,
}: {
  statements: CreditStatementView[]
}) {
  const cardId = useStatementFilters((s) => s.cardId)
  const periodByCard = useStatementFilters((s) => s.periodByCard)
  const setCardId = useStatementFilters((s) => s.setCardId)
  const setPeriod = useStatementFilters((s) => s.setPeriod)
  const [sheet, setSheet] = useState<Sheet>(null)
  if (!statements.length) return null
  const view = statements.find((s) => s.card.id === cardId) ?? statements[0]
  const period =
    view.periods.find((p) => p.key === periodByCard[view.card.id]) ??
    view.periods.find((p) => p.key === view.currentKey) ??
    view.periods[0]

  function close() {
    setSheet(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-(--primary)" /> Estados de cuenta
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <FilterPill
            label={cardLabel(view.card)}
            active={false}
            onClick={() => setSheet('card')}
          />
          <FilterPill
            label={period.label}
            active={period.key !== view.currentKey}
            onClick={() => setSheet('period')}
          />
        </div>
        {view.card.available != null && (
          <p className="text-center text-xs text-(--muted-foreground)">
            Disponible {formatMoney(view.card.available)}
          </p>
        )}
        <StatementPanel
          key={view.card.id}
          view={view}
          period={period}
          isCurrent={period.key === view.currentKey}
          onPeriodChange={(k) => setPeriod(view.card.id, k)}
        />

        <Dialog open={sheet !== null} onOpenChange={(o) => !o && close()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {sheet === 'card' && 'Seleccionar tarjeta'}
                {sheet === 'period' && 'Seleccionar periodo'}
              </DialogTitle>
            </DialogHeader>

            {sheet === 'card' && (
              <Options
                items={statements.map((s) => ({
                  value: s.card.id,
                  label: cardLabel(s.card),
                  total: s.card.currentDebt,
                }))}
                value={view.card.id}
                onPick={(v) => {
                  setCardId(v)
                  close()
                }}
              />
            )}
            {sheet === 'period' && (
              <Options
                items={view.periods.map((p) => ({
                  value: p.key,
                  label: p.label,
                  total: p.charges,
                  cap: true,
                }))}
                value={period.key}
                onPick={(v) => {
                  setPeriod(view.card.id, v)
                  close()
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
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

'use client'

import { useMemo, useState } from 'react'

import { CreditCard, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import {
  type CardPayCandidate,
  type CardPayReminder,
  cardPayMessage,
  dismissKeyForCardPay,
  getVisibleCardPay,
} from '@/lib/card-pay'
import { formatMoney } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { wallNow } from '@/lib/walltime'

const DISMISS_KEY = 'quanto:card-pay-dismissed'

function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

/**
 * Recordatorio de pago de mis tarjetas: el cierre del periodo vigente
 * (pago para no generar intereses), visible solo 3 días antes, 1 día
 * antes, el mismo día y a diario una vez vencido (hasta liquidar).
 * La X lo oculta solo hasta el próximo hito. `onPay` abre el pago
 * (Resumen); sin él no hay botón.
 */
export function CardPayReminders({
  items,
  onPay,
}: {
  items: CardPayCandidate[]
  onPay?: (item: CardPayReminder) => void
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const visible = useMemo(() => {
    const now = wallNow()
    return getVisibleCardPay(items, now).filter(
      (it) =>
        !dismissed.has(
          dismissKeyForCardPay(it.cardId, it.dueYMD, now, it.daysLeft),
        ),
    )
  }, [items, dismissed])

  if (visible.length === 0) return null

  function dismiss(item: CardPayReminder) {
    const now = wallNow()
    setDismissed((prev) => {
      const next = new Set(prev)
      // Poda: solo avisos de tarjetas actuales.
      const ids = new Set(items.map((d) => d.cardId))
      for (const k of next) {
        if (!ids.has(k.split(':')[0]!)) next.delete(k)
      }
      // Se oculta solo hasta el próximo hito (3/1/0) o mañana si venció;
      // siempre una sola fila por tarjeta.
      next.add(
        dismissKeyForCardPay(item.cardId, item.dueYMD, now, item.daysLeft),
      )
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]))
      } catch {
        // almacenamiento no disponible: se pierde al recargar
      }
      return next
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-(--primary)" /> Pagar tus tarjetas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visible.map((it) => {
          const expired = it.daysLeft < 0
          return (
            <div
              key={`${it.cardId}:${it.dueYMD}`}
              className={cn(
                'flex items-center gap-1.5 rounded-2xl p-3.5',
                expired ? 'bg-red-500/10' : 'bg-(--muted)/60',
              )}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {it.cardName}
                  {it.lastFour ? ` ··${it.lastFour}` : ''} ·{' '}
                  {formatMoney(it.closing)}
                </span>
                <span
                  className={cn(
                    'block truncate text-xs',
                    expired
                      ? 'font-semibold text-red-500'
                      : 'text-(--muted-foreground)',
                  )}>
                  {cardPayMessage(it.daysLeft)}
                  {it.dueLabel ? ` · límite ${it.dueLabel}` : ''}
                </span>
              </span>
              {onPay && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="shrink-0 rounded-full"
                  onClick={() => onPay(it)}>
                  Pagar
                </Button>
              )}
              <button
                type="button"
                aria-label="Quitar recordatorio"
                title="Quitar recordatorio"
                onClick={() => dismiss(it)}
                className="shrink-0 rounded-full p-1.5 text-(--muted-foreground) transition hover:bg-(--muted) hover:text-(--foreground)">
                <X className="size-4" />
              </button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

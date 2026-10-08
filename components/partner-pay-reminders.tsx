'use client'

import { useEffect, useMemo, useState } from 'react'

import { HandCoins, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import {
  type PartnerPayItem,
  type PartnerPayReminder,
  type PartnerPaySums,
  dismissKeyForPartnerPay,
  getPartnerPayReminders,
  partnerPayMessage,
} from '@/lib/partner-pay'
import { formatMoney } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { wallNow } from '@/lib/walltime'

const DISMISS_KEY = 'quanto:partner-pay-dismissed'

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
 * Recordatorio de pago a la pareja: visible solo 3 días antes, 1 día
 * antes, el mismo día y a diario una vez vencido (hasta que haya un
 * pago registrado para ese periodo). La X lo oculta solo hasta el
 * próximo hito. `onPay` abre el pago (Pareja); sin él no hay botón.
 */
export function PartnerPayReminders({
  debtItems,
  sums,
  onPay,
}: {
  debtItems: PartnerPayItem[]
  sums: PartnerPaySums
  onPay?: (item: PartnerPayReminder) => void
}) {
  // SSR no tiene localStorage: se inicia vacío (igual que el servidor) y
  // los descartes guardados se aplican tras montar (sin hydration mismatch).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => {
    const stored = loadDismissed()
    // Sincronización con sistema externo (localStorage) tras montar:
    // el estado inicial vacío coincide con el SSR (sin hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored.size > 0) setDismissed(stored)
  }, [])
  const items = useMemo(() => {
    const now = wallNow()
    return getPartnerPayReminders(debtItems, sums, now).filter(
      (it) =>
        !dismissed.has(
          dismissKeyForPartnerPay(it.accountId, it.dueYMD, now, it.daysLeft),
        ),
    )
  }, [debtItems, sums, dismissed])

  if (items.length === 0) return null

  function dismiss(item: PartnerPayReminder) {
    const now = wallNow()
    setDismissed((prev) => {
      const next = new Set(prev)
      // Poda: solo avisos de cuentas actuales.
      const ids = new Set(debtItems.map((d) => d.accountId))
      for (const k of next) {
        if (!ids.has(k.split(':')[0]!)) next.delete(k)
      }
      // Se oculta solo hasta el próximo hito (3/1/0) o mañana si venció;
      // siempre una sola fila por cuenta+vencimiento.
      next.add(
        dismissKeyForPartnerPay(
          item.accountId,
          item.dueYMD,
          now,
          item.daysLeft,
        ),
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
          <HandCoins className="size-4 text-(--primary)" /> Pagar a tu pareja
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((it) => {
          const expired = it.daysLeft < 0
          return (
            <div
              key={`${it.accountId}:${it.dueYMD}`}
              className={cn(
                'flex items-center gap-1.5 rounded-2xl p-3.5',
                expired ? 'bg-red-500/10' : 'bg-(--muted)/60',
              )}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {it.accountName} · {formatMoney(it.total)}
                </span>
                <span
                  className={cn(
                    'block truncate text-xs',
                    expired
                      ? 'font-semibold text-red-500'
                      : 'text-(--muted-foreground)',
                  )}>
                  A {it.creditorName} · {partnerPayMessage(it.daysLeft)}
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

'use client'

import { useEffect, useMemo, useState } from 'react'

import { CreditCard, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import {
  daysUntilExpiry,
  dismissKeyFor,
  expiryMessage,
  shouldRemindExpiry,
} from '@/lib/expiry'
import { cn } from '@/lib/utils'

export type ExpiryAccount = {
  id: string
  name: string
  lastFour: string | null
  expiry: string | null
  color: string
}

const DISMISS_KEY = 'quanto:expiry-dismissed'

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
 * Recordatorio de renovación: visible a diario desde el tercer mes previo
 * (incluyendo vencida). `onRenew` abre la edición directo (Cuentas); sin
 * él navega a /cuentas?editar=<id>. La X lo oculta hasta el próximo corte
 * (1/15, o cada 5 días si ya venció).
 */
export function ExpiryReminders({
  accounts,
  onRenew,
}: {
  accounts: ExpiryAccount[]
  onRenew?: (accountId: string) => void
}) {
  const router = useRouter()
  // SSR no tiene localStorage: se inicia vacío (igual que el servidor) y
  // los descartes guardados se aplican tras montar. Así el primer pintado
  // del cliente coincide con el HTML y no hay hydration mismatch.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  useEffect(() => {
    const stored = loadDismissed()
    // Sincronización con sistema externo (localStorage) tras montar:
    // el estado inicial vacío coincide con el SSR (sin hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored.size > 0) setDismissed(stored)
  }, [])
  const items = useMemo(() => {
    const now = new Date()
    return accounts
      .map((a) => ({ a, days: daysUntilExpiry(a.expiry, now) }))
      .filter(
        (it): it is { a: ExpiryAccount; days: number } =>
          it.days != null && shouldRemindExpiry(it.a.expiry, now),
      )
      .filter(
        (it) =>
          !dismissed.has(
            dismissKeyFor(it.a.id, it.a.expiry!, now, it.days < 0),
          ),
      )
      .sort((x, y) => x.days - y.days)
  }, [accounts, dismissed])

  if (items.length === 0) return null

  function dismiss(id: string, expiry: string, days: number) {
    const now = new Date()
    setDismissed((prev) => {
      const next = new Set(prev)
      // Poda: solo avisos de cuentas actuales.
      const ids = new Set(accounts.map((a) => a.id))
      for (const k of next) {
        if (!ids.has(k.split(':')[0]!)) next.delete(k)
      }
      // Se oculta hasta el próximo corte (1/15, o cada 5 días si venció);
      // siempre una sola fila por cuenta.
      next.add(dismissKeyFor(id, expiry, now, days < 0))
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]))
      } catch {
        // almacenamiento no disponible: se pierde al recargar
      }
      return next
    })
  }

  function renew(id: string) {
    if (onRenew) onRenew(id)
    else router.push(`/cuentas?editar=${id}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-(--primary)" /> Renovar tarjetas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map(({ a, days }) => {
          const expired = days < 0
          return (
            <div
              key={a.id}
              className={cn(
                'flex items-center gap-1.5 rounded-2xl p-3.5',
                expired ? 'bg-red-500/10' : 'bg-(--muted)/60',
              )}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {a.name}
                  {a.lastFour ? ` ··${a.lastFour}` : ''}
                </span>
                <span
                  className={cn(
                    'block text-xs',
                    expired
                      ? 'font-semibold text-red-500'
                      : 'text-(--muted-foreground)',
                  )}>
                  {expiryMessage(days, a.expiry!)}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 rounded-full"
                onClick={() => renew(a.id)}>
                Ya la renové
              </Button>
              <button
                type="button"
                aria-label="Quitar recordatorio"
                title="Quitar recordatorio"
                onClick={() => dismiss(a.id, a.expiry!, days)}
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

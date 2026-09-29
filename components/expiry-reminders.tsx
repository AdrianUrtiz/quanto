'use client'

import { useMemo, useState } from 'react'

import { CreditCard, X } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import {
  daysUntilExpiry,
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

/** Clave de descarte: por hito (90/75/…/15) o fija una vez vencida. */
function dismissKey(id: string, expiry: string, days: number) {
  return `${id}:${expiry}:${days <= 0 ? 'vencida' : days}`
}

function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * Recordatorio de renovación: hitos 90/75/…/15 días y siempre si venció.
 * `onRenew` abre la edición directo (Cuentas); sin él navega a
 * /cuentas?editar=<id>. Cada aviso se puede descartar con la X.
 */
export function ExpiryReminders({
  accounts,
  onRenew,
}: {
  accounts: ExpiryAccount[]
  onRenew?: (accountId: string) => void
}) {
  const router = useRouter()
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const items = useMemo(() => {
    const now = new Date()
    return accounts
      .map((a) => ({ a, days: daysUntilExpiry(a.expiry, now) }))
      .filter(
        (it): it is { a: ExpiryAccount; days: number } =>
          it.days != null && shouldRemindExpiry(it.days),
      )
      .filter((it) => !dismissed.has(dismissKey(it.a.id, it.a.expiry!, it.days)))
      .sort((x, y) => x.days - y.days)
  }, [accounts, dismissed])

  if (items.length === 0) return null

  function dismiss(id: string, expiry: string, days: number) {
    setDismissed((prev) => {
      const next = new Set(prev)
      // Poda: solo avisos de cuentas actuales.
      const ids = new Set(accounts.map((a) => a.id))
      for (const k of next) {
        if (!ids.has(k.split(':')[0]!)) next.delete(k)
      }
      next.add(dismissKey(id, expiry, days))
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
                variant='outline'
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

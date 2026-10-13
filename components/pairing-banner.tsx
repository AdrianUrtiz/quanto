'use client'

import { HeartHandshake } from 'lucide-react'
import Link from 'next/link'

import type { PairingInviteItem } from '@/lib/offline/snapshot'
import { cn } from '@/lib/utils'

/**
 * Banner de solicitudes de vínculo de pareja pendientes.
 * Aparece en Actividad y lleva a Ajustes > Pareja para aceptar/rechazar.
 */
export function PairingBanner({
  items,
  compact,
}: {
  items: PairingInviteItem[]
  compact?: boolean
}) {
  if (!items.length) return null

  return (
    <div className={cn('space-y-2', !compact && 'px-5 pt-4')}>
      {items.map((p) => (
        <Link
          key={p.id}
          href="/ajustes"
          className="flex w-full items-center gap-3 rounded-3xl border border-pink-500/30 bg-pink-500/[0.07] p-3.5 text-left transition active:scale-[.99]">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-pink-500/15">
            <HeartHandshake className="size-5 text-pink-500" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {p.fromName} quiere ser tu pareja
            </span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              Acepta o rechaza la solicitud
            </span>
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-pink-500">
            Revisar ›
          </span>
        </Link>
      ))}
    </div>
  )
}

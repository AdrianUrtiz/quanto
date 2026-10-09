import { CreditCard, Landmark } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Icono de cuenta con el color asociado (mismo que AccountCard). */
export function AccountBadge({
  type,
  color,
  className,
}: {
  type?: string
  color?: string | null
  className?: string
}) {
  const Icon = type === 'CREDIT' ? CreditCard : Landmark
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-xl text-white',
        className,
      )}
      style={{ background: color ?? '#6366f1' }}>
      <Icon className="size-4" />
    </span>
  )
}

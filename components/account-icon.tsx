import { CreditCard, Landmark } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Icono de cuenta (tarjeta o banco) en su color asociado, sin fondo. */
export function AccountIcon({
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
    <Icon
      aria-hidden
      className={cn('size-5 shrink-0', className)}
      style={{ color: color ?? '#6366f1' }}
    />
  )
}

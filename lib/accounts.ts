import type { AccountOpt } from '@/components/transaction-form'

/** Orden global de cuentas: favorita primero, luego manual, luego creación. */
export function byAccountOrder(
  x: Pick<AccountOpt, 'isFavorite' | 'position'>,
  y: Pick<AccountOpt, 'isFavorite' | 'position'>,
): number {
  return (
    Number(y.isFavorite ?? false) - Number(x.isFavorite ?? false) ||
    (x.position ?? 0) - (y.position ?? 0)
  )
}

/** Fila mínima (Prisma select u OfflineAccount) → opción ordenable. */
export function toAccountOpt(a: {
  id: string
  name: string
  type?: string | null
  color?: string | null
  isFavorite?: boolean | null
  position?: number | null
}): AccountOpt {
  return {
    id: a.id,
    name: a.name,
    type: a.type ?? undefined,
    color: a.color ?? undefined,
    isFavorite: a.isFavorite ?? undefined,
    position: a.position ?? undefined,
  }
}

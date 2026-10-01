import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

import { fromCents, toCents } from '@/lib/money'
import { fmtMonthYear, monthKeyOfWall } from '@/lib/walltime'

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Muestra SIEMPRE centavos ($1,234.50). Acepta number, string numérico o
 * Decimal de Prisma. `exact` queda como no-op por compatibilidad.
 */
export function formatMoney(
  value: number | string | { toString(): string },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  exact = true,
) {
  const cents = toCents(
    value as unknown as number | string | { toString(): string },
  )
  if (Number.isNaN(cents)) return '$0.00'
  return mxn.format(fromCents(cents))
}

export function monthKey(d: Date) {
  // Hora-muro (ver lib/walltime.ts): getters UTC = día real en México.
  return monthKeyOfWall(d)
}

export function monthLabelEs(d: Date) {
  return fmtMonthYear(d)
}

// Moneda — única fuente de verdad para montos en MXN.
//
// - Postgres guarda `Decimal(12,2)`. Prisma lo devuelve como `Decimal`.
// - En JS operamos en centavos enteros para evitar deriva IEEE-754
//   (0.1+0.2, 100/3, splits 50/50).
// - Regla: parsea en el borde con `toCents`, opera en enteros, convierte a
//   pesos solo para persistir (`fromCents`) o mostrar (`formatMoney`).
// - Prohibido: `Number(amount)` suelto para aritmética, `toFixed`,
//   `Math.round(x*100)/100` dispersos, epsilons `> 0.005`.

import { z } from 'zod'

export type MoneyInput = number | string | { toString(): string } | null | undefined

/** "19.99" | 19.99 | Decimal → 1999 (redondeo half-up a 2 decimales). */
export function toCents(value: MoneyInput): number {
  if (value == null) return 0
  const raw = typeof value === 'number' ? String(value) : String(value).trim()
  if (raw === '' || raw === 'null' || raw === 'undefined') return 0
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw.replace(/,/g, ''))
  if (!m) return NaN
  const neg = m[1] === '-' ? -1 : 1
  const intPart = m[2] === '' ? '0' : m[2]
  let frac = (m[3] ?? '').replace(/[^0-9]/g, '')
  // Redondeo half-up si hay más de 2 decimales.
  let roundUp = false
  if (frac.length > 2) {
    roundUp = Number(frac[2] ?? '0') >= 5
    frac = frac.slice(0, 2)
  }
  while (frac.length < 2) frac += '0'
  let cents = Number(intPart) * 100 + Number(frac)
  if (roundUp) cents += 1
  return neg * cents
}

/** 1999 → 19.99 */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/** Normaliza cualquier entrada a pesos con 2 decimales exactos. */
export function normalizeMoney(value: MoneyInput): number {
  return fromCents(toCents(value))
}

/** Suma exacta en pesos (opera en centavos). */
export function addMoney(...values: MoneyInput[]): number {
  return fromCents(
    values.reduce<number>((a, v) => a + toCents(v), 0),
  )
}

/** Resta exacta: a - b, en pesos. */
export function subMoney(a: MoneyInput, b: MoneyInput): number {
  return fromCents(toCents(a) - toCents(b))
}

/**
 * Divide un total en `n` parcialidades que suman exacto.
 * La última absorbe el residuo (como los bancos con MSI).
 * Devuelve pesos. Ej: splitMoney(100, 3) → [33.33, 33.33, 33.34].
 */
export function splitMoney(total: MoneyInput, n: number): number[] {
  const k = Math.max(1, Math.round(n))
  const totalC = toCents(total)
  if (k === 1) return [fromCents(totalC)]
  const base = Math.floor(totalC / k)
  const out = Array(k - 1).fill(base)
  out.push(totalC - base * (k - 1))
  return out.map(fromCents)
}

/**
 * Cuota mensual del deudor en pesos, redondeada a centavos.
 * Si hay monto fijo pactado se prorratea ese; si no, porcentaje del total.
 */
export function debtorShareCents(
  total: MoneyInput,
  installments: number,
  opts: { sharePct?: number; shareAmount?: MoneyInput } = {},
): number {
  const n = Math.max(1, Math.round(installments))
  const poolC =
    opts.shareAmount != null && String(opts.shareAmount) !== ''
      ? toCents(opts.shareAmount)
      : Math.round((toCents(total) * (opts.sharePct ?? 50)) / 100)
  return Math.round(poolC / n)
}

/**
 * String con 2 decimales sin pasar por flotantes ("1999c" → "19.99").
 * Para inputs de formularios y vistas previas (no usa `toFixed` flotante).
 */
export function toFixedCents(value: MoneyInput): string {
  const cents = toCents(value)
  if (Number.isNaN(cents)) return '0.00'
  const neg = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${neg}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Comparaciones en centavos (sin epsilons). */
export function isZeroMoney(v: MoneyInput): boolean {
  return toCents(v) === 0
}
export function isPositiveMoney(v: MoneyInput): boolean {
  return toCents(v) > 0
}

/**
 * Schema zod para montos en el borde (FormData → number en pesos, 2 dec).
 * Redondea "19.999" → 20.00 en vez de guardar deriva flotante.
 */
export const moneySchema = z.coerce
  .number()
  .positive('Monto debe ser mayor a 0')
  .transform((v) => normalizeMoney(v))
  .refine((v) => toCents(v) > 0, 'Monto debe ser mayor a 0')

export const optionalMoneySchema = z.coerce
  .number()
  .positive()
  .optional()
  .transform((v) => (v == null ? undefined : normalizeMoney(v)))

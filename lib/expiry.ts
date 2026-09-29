// Vencimiento de tarjetas (MM/AA) y recordatorios de renovación.
//
// - La tarjeta vence el último día del mes indicado.
// - Se recuerda a los 90 / 75 / 60 / 45 / 30 / 15 días antes y, una vez
//   vencida, se muestra siempre como vencida hasta que se actualice.

const EXPIRY_RE = /^(0[1-9]|1[0-2])\/(\d{2})$/

/** "MM/AA" → último día del mes (23:59). Null si formato inválido. */
export function expiryEnd(expiry: string | null | undefined): Date | null {
  if (!expiry) return null
  const m = EXPIRY_RE.exec(expiry.trim())
  if (!m) return null
  const month = Number(m[1])
  const year = 2000 + Number(m[2])
  return new Date(year, month, 0, 23, 59, 59, 999)
}

/** Días (redondeados hacia arriba) hasta el vencimiento. Null sin dato. */
export function daysUntilExpiry(
  expiry: string | null | undefined,
  now = new Date(),
): number | null {
  const end = expiryEnd(expiry)
  if (!end) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000)
}

/**
 * ¿Mostrar recordatorio? Desde 90 días antes en hitos cada 15 días
 * (90, 75, 60, 45, 30, 15, 0) y siempre una vez vencida.
 */
export function shouldRemindExpiry(daysLeft: number | null): boolean {
  if (daysLeft == null || daysLeft > 90) return false
  return daysLeft <= 0 || daysLeft % 15 === 0
}

/** Texto del recordatorio según los días restantes. */
export function expiryMessage(daysLeft: number, expiry: string): string {
  if (daysLeft > 1) return `Vence en ${daysLeft} días · ${expiry}`
  if (daysLeft === 1) return `Vence mañana · ${expiry}`
  if (daysLeft === 0) return `Vence hoy · ${expiry}`
  if (daysLeft === -1) return `Venció ayer · ${expiry}`
  return `Venció hace ${-daysLeft} días · ${expiry}`
}

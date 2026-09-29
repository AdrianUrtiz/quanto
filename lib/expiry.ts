// Vencimiento de tarjetas (MM/AA) y recordatorios de renovación.
//
// - La tarjeta vence el último día del mes indicado.
// - El aviso vive desde el día 1 del tercer mes previo (ej. 09/26 avisa
//   desde el 1 de julio, ~90 días) y sigue a diario hasta que se actualice
//   el dato, incluyendo ya vencida.
// - Descartar (X) lo oculta hasta el próximo corte: días 1 y 15 si aún no
//   vence; cada 5 días (1, 5, 10, 15, 20, 25) si ya venció. Siempre hay
//   una sola fila por tarjeta, nunca duplicados.

const EXPIRY_RE = /^(0[1-9]|1[0-2])\/(\d{2})$/

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** "MM/AA" → { año, mes 0-based }. Null si formato inválido. */
export function parseExpiry(expiry: string | null | undefined): {
  year: number
  month0: number
} | null {
  if (!expiry) return null
  const m = EXPIRY_RE.exec(expiry.trim())
  if (!m) return null
  return { year: 2000 + Number(m[2]), month0: Number(m[1]) - 1 }
}

/** "MM/AA" → último día del mes (23:59). Null si formato inválido. */
export function expiryEnd(expiry: string | null | undefined): Date | null {
  const p = parseExpiry(expiry)
  if (!p) return null
  return new Date(p.year, p.month0 + 1, 0, 23, 59, 59, 999)
}

/** Día 1 del tercer mes previo (09/26 → 1 jul 2026). */
export function reminderStart(expiry: string | null | undefined): Date | null {
  const p = parseExpiry(expiry)
  if (!p) return null
  return new Date(p.year, p.month0 - 2, 1)
}

/** ¿Mostrar aviso? Desde el inicio de la ventana, sin fecha de fin. */
export function shouldRemindExpiry(
  expiry: string | null | undefined,
  now = new Date(),
): boolean {
  const start = reminderStart(expiry)
  if (!start) return false
  return startOfDay(now).getTime() >= startOfDay(start).getTime()
}

/** Quincena vigente: 'A' días 1–14, 'B' días 15–fin. */
export function currentHalfPeriod(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate() < 15 ? 'A' : 'B'}`
}

/** Tramo vigente para vencidas: arranca los días 1, 5, 10, 15, 20 y 25. */
export function currentExpiredPeriod(now = new Date()): string {
  let start = 1
  for (const b of [5, 10, 15, 20, 25]) {
    if (now.getDate() >= b) start = b
    else break
  }
  return `${now.getFullYear()}-${now.getMonth() + 1}-V${start}`
}

/** Clave de descarte: por cuenta + vencimiento + tramo vigente. */
export function dismissKeyFor(
  id: string,
  expiry: string,
  now = new Date(),
  expired = false,
): string {
  const period = expired ? currentExpiredPeriod(now) : currentHalfPeriod(now)
  return `${id}:${expiry.trim()}:${period}`
}

/** Días (redondeados hacia arriba) hasta el vencimiento. Null sin dato. */
export function daysUntilExpiry(
  expiry: string | null | undefined,
  now = new Date(),
): number | null {
  const end = expiryEnd(expiry)
  if (!end) return null
  return Math.ceil((end.getTime() - startOfDay(now).getTime()) / 86_400_000)
}

/** Texto del recordatorio según los días restantes. */
export function expiryMessage(daysLeft: number, expiry: string): string {
  if (daysLeft > 1) return `Vence en ${daysLeft} días · ${expiry}`
  if (daysLeft === 1) return `Vence mañana · ${expiry}`
  if (daysLeft === 0) return `Vence hoy · ${expiry}`
  if (daysLeft === -1) return `Venció ayer · ${expiry}`
  return `Venció hace ${-daysLeft} días · ${expiry}`
}

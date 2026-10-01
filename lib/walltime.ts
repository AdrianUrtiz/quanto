// Hora-muro de México como única fuente de verdad para fechas.
//
// Regla: todo `Transaction.date` guardado es la hora-muro de México
// etiquetada como UTC. Así la base de datos muestra EXACTAMENTE lo mismo
// que la aplicación (el visor de la BD lee en UTC y la app formatea en UTC).
//
// - Escritura: `parseWallInput` (formulario) y `wallNow` (automáticos).
// - Lectura/cálculo: getters UTC (`getUTCFullYear`, …) o `timeZone: 'UTC'`.
// - "Hoy": `todayMexicoYMD` / `mexicoMonthKey` (día real en México, no UTC).
//
// Solo aplica a la pareja (misma zona horaria). No usar para nada que
// requiera instante real (eso no existe en esta app: no hay push ni sync).

export const APP_TZ = 'America/Mexico_City'

const two = (n: number) => String(n).padStart(2, '0')

let mexicoFmt: Intl.DateTimeFormat | null = null
function mexicoParts(at: Date): {
  y: number
  m0: number
  d: number
  h: number
  min: number
  s: number
} {
  mexicoFmt ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const p of mexicoFmt.formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  return {
    y: Number(parts.year),
    m0: Number(parts.month) - 1,
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    s: Number(parts.second),
  }
}

/** Construye un Date etiquetado UTC desde partes (hora-muro). */
export function utc(
  y: number,
  m0: number,
  d: number,
  h = 0,
  min = 0,
  s = 0,
  ms = 0,
): Date {
  return new Date(Date.UTC(y, m0, d, h, min, s, ms))
}

/** "Ahora" en hora-muro de México, etiquetado UTC. */
export function wallNow(at = new Date()): Date {
  const p = mexicoParts(at)
  return utc(p.y, p.m0, p.d, p.h, p.min, p.s, at.getMilliseconds())
}

/** "YYYY-MM-DD" del día real en México. */
export function todayMexicoYMD(at = new Date()): string {
  const p = mexicoParts(at)
  return `${p.y}-${two(p.m0 + 1)}-${two(p.d)}`
}

/** "YYYY-MM" del mes real en México. */
export function mexicoMonthKey(at = new Date()): string {
  const p = mexicoParts(at)
  return `${p.y}-${two(p.m0 + 1)}`
}

const WALL_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/

/**
 * Parsea "YYYY-MM-DD[THH:MM[:SS[.mmm]]]" (hora-muro del formulario)
 * como UTC. Determinista en cualquier runtime (dev local o Vercel).
 * Acepta ISO con offset/Z (se respeta el instante, p. ej. defaults).
 */
export function parseWallInput(s: string): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s)
  const m = WALL_RE.exec(s.trim())
  if (!m) return new Date(NaN)
  const ms = (m[7] ?? '0').padEnd(3, '0')
  return utc(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? '0'),
    Number(m[5] ?? '0'),
    Number(m[6] ?? '0'),
    Number(ms),
  )
}

/** "YYYY-MM-DD" de un Date con hora-muro (getters UTC). */
export function ymdOfWall(d: Date): string {
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`
}

/** "YYYY-MM" de un Date con hora-muro (getters UTC). */
export function monthKeyOfWall(d: Date): string {
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}`
}

/** Suma días calendario a una hora-muro (UTC no tiene DST: exacto). */
export function addWallDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}

/** Suma meses calendario a (año, mes 0-based). */
export function addWallMonths(
  y: number,
  m0: number,
  delta: number,
): { y: number; m0: number } {
  const t = m0 + delta
  const ny = y + Math.floor(t / 12)
  const nm0 = ((t % 12) + 12) % 12
  return { y: ny, m0: nm0 }
}

/** Días del mes (matemática pura, sin zona horaria). */
export function daysInWallMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
}

/** 00:00:00.000 del día-muro. */
export function startOfWallDay(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** 23:59:59.999 del día-muro. */
export function endOfWallDay(d: Date): Date {
  return utc(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    23,
    59,
    59,
    999,
  )
}

function fmt(
  d: Date | string,
  opts: Intl.DateTimeFormatOptions,
  dot = false,
): string {
  const dtf = new Intl.DateTimeFormat('es-MX', {
    ...opts,
    timeZone: 'UTC',
  })
  const s = dtf.format(d instanceof Date ? d : new Date(d))
  return dot ? s : s.replace('.', '')
}

/** "30 sep" (igual que `toLocaleDateString('es-MX', {day, month short})`). */
export function fmtDayMonth(d: Date | string): string {
  return fmt(d, { day: 'numeric', month: 'short' })
}

/** "septiembre de 2026" (igual que `{month: 'long', year: 'numeric'}`). */
export function fmtMonthYear(d: Date | string): string {
  return fmt(d, { month: 'long', year: 'numeric' })
}

/** "septiembre" / "sep" (mes de una hora-muro). */
export function fmtMonthLong(d: Date | string): string {
  return fmt(d, { month: 'long' })
}
export function fmtMonthShort(d: Date | string): string {
  return fmt(d, { month: 'short' })
}

/** Etiqueta "OCT 26" de estados de cuenta (mes + año corto). */
export function fmtChartLabel(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d)
  const mon = fmt(dt, { month: 'short' }).toUpperCase()
  return `${mon} ${String(dt.getUTCFullYear()).slice(2)}`
}

/** Día del mes 1-31 de una hora-muro. */
export function wallDay(d: Date | string): number {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.getUTCDate()
}

/** Día de semana 0-6 (dom-sáb) de una hora-muro. */
export function wallWeekday(d: Date | string): number {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.getUTCDay()
}

export const WD_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export type WallRange =
  | 'mensual'
  | 'semanal'
  | 'trimestral'
  | 'seis'
  | 'anio'
  | 'todo'

/**
 * Inicio del rango (fin = hoy completo). `base` = hoy muro etiquetado UTC
 * (wallNow()). Null = mes seleccionado. Todo en hora-muro.
 */
export function rangeStartWall(range: WallRange, base: Date): Date | null {
  const y = base.getUTCFullYear()
  const m0 = base.getUTCMonth()
  const d = base.getUTCDate()
  switch (range) {
    case 'mensual':
      return null
    case 'semanal':
      return utc(y, m0, d - 6)
    case 'trimestral':
      return utc(y, 0, 1)
    case 'seis': {
      const p = addWallMonths(y, m0, -5)
      return utc(p.y, p.m0, 1)
    }
    case 'anio':
      return utc(y, 0, 1)
    case 'todo':
      return utc(2000, 0, 1)
  }
}

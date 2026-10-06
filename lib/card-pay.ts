// Recordatorios de pago de MIS tarjetas (soy el propietario).
//
// - El monto es el cierre del periodo (pago para no generar intereses),
//   no solo lo que me debe mi pareja: incluye mis cargos + su parte.
// - Cubre todo crédito con día límite de pago, tenga o no corte.
// - Se muestra solo en días discretos: 3 días antes, 1 día antes, el
//   mismo día y todos los días una vez vencido (hasta liquidar el
//   periodo: cierre en cero). Un abono parcial reduce el cierre pero
//   no apaga el aviso.
// - Si el periodo venció sin pagarse, se sigue mostrando a diario con
//   el cierre de ese corte (el más antiguo vencido sin liquidar).
// - Descartar (X) lo oculta solo hasta el próximo hito: cada checkpoint
//   (3/1/0) tiene su propia clave y el vencido se oculta por día.
//   Siempre hay una sola fila por tarjeta, nunca duplicados.
import { toCents } from '@/lib/money'
import { startOfWallDay, wallNow, ymdOfWall } from '@/lib/walltime'

/** Candidato serializable (lo calcula el servidor desde los cortes). */
export type CardPayCandidate = {
  cardId: string
  cardName: string
  lastFour: string | null
  /** Cierre del periodo (pago para no generar intereses). */
  closing: number
  /** Vencimiento del periodo (ISO hora-muro). */
  dueDateISO: string
  /** Clave del periodo ("YYYY-MM" del corte). */
  periodKey: string
  /** Etiqueta del periodo ("Septiembre de 2026"). */
  periodLabel: string
  /** Etiqueta del límite ("24 de septiembre"). */
  dueLabel: string | null
  /** True si es el periodo vigente a pagar. */
  isCurrent: boolean
}

export type CardPayReminder = CardPayCandidate & {
  dueDate: Date
  /** "YYYY-MM-DD" del vencimiento (para la clave de descarte). */
  dueYMD: string
  daysLeft: number
  overdue: boolean
}

/** Días-checkpoint en los que se avisa antes del vencimiento. */
const LEAD_DAYS = new Set([3, 1, 0])

function daysBetween(fromStart: Date, toStart: Date): number {
  return Math.round((toStart.getTime() - fromStart.getTime()) / 86_400_000)
}

/**
 * Recordatorios vigentes hoy: una fila por tarjeta. Si hay periodos
 * vencidos sin liquidar se muestra el más antiguo (a diario); si no,
 * el vigente solo en sus hitos (3/1/0). Ordenados por urgencia.
 */
export function getVisibleCardPay(
  candidates: CardPayCandidate[],
  now = wallNow(),
): CardPayReminder[] {
  const today = startOfWallDay(now)
  const byCard = new Map<string, CardPayReminder[]>()
  for (const c of candidates) {
    if (toCents(c.closing) <= 0) continue // periodo liquidado
    const dueDate = new Date(c.dueDateISO)
    if (Number.isNaN(dueDate.getTime())) continue
    const daysLeft = daysBetween(today, startOfWallDay(dueDate))
    const r: CardPayReminder = {
      ...c,
      dueDate,
      dueYMD: ymdOfWall(dueDate),
      daysLeft,
      overdue: daysLeft < 0,
    }
    const arr = byCard.get(c.cardId) ?? []
    arr.push(r)
    byCard.set(c.cardId, arr)
  }
  const out: CardPayReminder[] = []
  for (const arr of byCard.values()) {
    // Vencidos sin liquidar: el más antiguo, todos los días.
    const overdue = arr
      .filter((r) => r.daysLeft < 0)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    if (overdue.length > 0) {
      out.push(overdue[0]!)
      continue
    }
    // Vigente: solo en sus hitos.
    const current = arr.find((r) => r.isCurrent)
    if (current && LEAD_DAYS.has(current.daysLeft)) out.push(current)
  }
  return out.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft || a.cardName.localeCompare(b.cardName, 'es'),
  )
}

/** Clave de descarte: por tarjeta + vencimiento + hito vigente. */
export function dismissKeyForCardPay(
  cardId: string,
  dueYMD: string,
  now = wallNow(),
  daysLeft = 0,
): string {
  // Vencido: se oculta solo hoy, mañana vuelve hasta liquidar.
  if (daysLeft < 0) return `${cardId}:${dueYMD}:over:${ymdOfWall(now)}`
  return `${cardId}:${dueYMD}:d${daysLeft}`
}

/** Texto del recordatorio según los días restantes. */
export function cardPayMessage(daysLeft: number): string {
  if (daysLeft > 1) return `Vence en ${daysLeft} días`
  if (daysLeft === 1) return 'Vence mañana'
  if (daysLeft === 0) return 'Vence hoy'
  if (daysLeft === -1) return 'Venció ayer'
  return `Venció hace ${-daysLeft} días`
}

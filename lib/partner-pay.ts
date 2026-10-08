// Recordatorios de pago a la pareja (lo que YO le debo).
//
// - La fecha límite es el vencimiento de la tarjeta de la pareja
//   (dueDate del corte vía payableInstallments; sin corte se usa el
//   dueDay del mes exigible y sin dato el fin de mes).
// - Se muestra solo en días discretos: 3 días antes, 1 día antes, el
//   mismo día y todos los días una vez vencido (hasta que haya pago).
// - Registrar CUALQUIER pago (PENDING o CONFIRMED) para ese periodo
//   suprime sus recordatorios: si pagas 5 o 2 días antes, los
//   siguientes (1 día, mismo día) ya no aparecen.
// - Descartar (X) lo oculta solo hasta el próximo hito: cada checkpoint
//   (3/1/0) tiene su propia clave y el vencido se oculta por día.
//   Siempre hay una sola fila por cuenta+vencimiento, nunca duplicados.
import { payableInstallments } from '@/lib/calculations'
import { toCents } from '@/lib/money'
import {
  daysInWallMonth,
  monthKeyOfWall,
  startOfWallDay,
  utc,
  wallNow,
  ymdOfWall,
} from '@/lib/walltime'

/** Entrada mínima (compatible con DebtItemInput de partner-debts). */
export type PartnerPayItem = {
  shareId: string
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  dueDay?: number | null
  statementDay?: number | null
  creditorName: string
  concept: string
  monthly: number
  installments: number
  date: string // ISO
}

export type PartnerPaySums = Map<string, { confirmed: number; pending: number }>

export type PartnerPayReminder = {
  accountId: string
  accountName: string
  creditorName: string
  /** Suma de mensualidades no atendidas que vencen ese día. */
  total: number
  /** Día de pago (hora-muro, mediodía). */
  dueDate: Date
  /** "YYYY-MM-DD" del vencimiento (para la clave de descarte). */
  dueYMD: string
  /** Mes exigible ("YYYY-MM"): para abrir Pareja en ese periodo. */
  dueKey: string
  daysLeft: number
  overdue: boolean
}

/** Días-checkpoint en los que se avisa antes del vencimiento. */
const LEAD_DAYS = new Set([3, 1, 0])

function fallbackDueDate(dueKey: string, dueDay?: number | null): Date {
  const [y, mo] = dueKey.split('-').map(Number)
  const m0 = mo - 1
  if (dueDay != null && dueDay >= 1 && dueDay <= 31) {
    const dim = daysInWallMonth(y, m0)
    return utc(y, m0, Math.min(Math.round(dueDay), dim), 12, 0, 0)
  }
  // Débito o sin día límite: fin de mes.
  return utc(y, m0, daysInWallMonth(y, m0), 12, 0, 0)
}

function daysBetween(fromStart: Date, toStart: Date): number {
  return Math.round((toStart.getTime() - fromStart.getTime()) / 86_400_000)
}

/**
 * Recordatorios vigentes hoy: una fila por cuenta+vencimiento con
 * deuda no atendida (sin ningún PENDING/CONFIRMED en ese periodo).
 * Ordenados por urgencia (más vencidos primero).
 */
export function getPartnerPayReminders(
  items: PartnerPayItem[],
  sums: PartnerPaySums,
  now = wallNow(),
): PartnerPayReminder[] {
  const today = startOfWallDay(now)
  const byKey = new Map<string, PartnerPayReminder>()
  for (const it of items) {
    if (!it.shareId) continue // demo: sin pagos posibles
    let parts: ReturnType<typeof payableInstallments>
    try {
      parts = payableInstallments(
        new Date(it.date),
        it.installments,
        it.statementDay,
        it.dueDay,
      )
    } catch {
      continue
    }
    for (const p of parts) {
      const s = sums.get(`${it.shareId}:${p.payKey}`)
      const paidCents = toCents(s?.confirmed ?? 0) + toCents(s?.pending ?? 0)
      // Cualquier registro para ese periodo suprime sus avisos.
      if (paidCents > 0) continue
      const dueDate = p.dueDate ?? fallbackDueDate(p.dueKey, it.dueDay)
      const daysLeft = daysBetween(today, startOfWallDay(dueDate))
      if (!(LEAD_DAYS.has(daysLeft) || daysLeft < 0)) continue
      const dueYMD = ymdOfWall(dueDate)
      const gk = `${it.accountId}:${dueYMD}`
      const g =
        byKey.get(gk) ??
        ({
          accountId: it.accountId,
          accountName: it.accountName,
          creditorName: it.creditorName,
          total: 0,
          dueDate,
          dueYMD,
          dueKey: p.dueKey,
          daysLeft,
          overdue: daysLeft < 0,
        } satisfies PartnerPayReminder)
      // Sin pagos registrados aquí: lo pendiente es la mensualidad.
      g.total = Math.round((g.total + it.monthly) * 100) / 100
      // Si el mismo vencimiento agrupa varias líneas, el día es el mismo.
      if (daysLeft < g.daysLeft) {
        g.daysLeft = daysLeft
        g.overdue = true
      }
      byKey.set(gk, g)
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.daysLeft - b.daysLeft ||
      a.accountName.localeCompare(b.accountName, 'es'),
  )
}

/** Clave de descarte: por cuenta + vencimiento + hito vigente. */
export function dismissKeyForPartnerPay(
  accountId: string,
  dueYMD: string,
  now = wallNow(),
  daysLeft = 0,
): string {
  // Vencido: se oculta solo hoy, mañana vuelve hasta que haya pago.
  if (daysLeft < 0) return `${accountId}:${dueYMD}:over:${ymdOfWall(now)}`
  return `${accountId}:${dueYMD}:d${daysLeft}`
}

/** Texto del recordatorio según los días restantes. */
export function partnerPayMessage(daysLeft: number): string {
  if (daysLeft > 1) return `Vence en ${daysLeft} días`
  if (daysLeft === 1) return 'Vence mañana'
  if (daysLeft === 0) return 'Vence hoy'
  if (daysLeft === -1) return 'Venció ayer'
  return `Venció hace ${-daysLeft} días`
}

/** Mes exigible ("YYYY-MM") de un vencimiento, para abrir Pareja ahí. */
export function dueKeyOf(dueDate: Date): string {
  return monthKeyOfWall(dueDate)
}

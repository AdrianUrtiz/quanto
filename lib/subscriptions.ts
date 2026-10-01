// Suscripciones como checklist mensual: el cargo es un hecho indivisible en la
// tarjeta del dueño; lo único que se rastrea es quién cubrió su parte.
// Sin TransactionShare ni DebtPayment para suscripciones.
import { fromCents, toCents } from '@/lib/money'

import {
  addWallMonths,
  daysInWallMonth,
  fmtMonthShort,
  fmtMonthYear,
  monthKeyOfWall,
  startOfWallDay,
  utc,
  wallNow,
} from '@/lib/walltime'

export type SubInfo = {
  id: string
  name: string
  amount: number
  category: string
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  chargeDay: number
  isShared: boolean
  sharePct: number
  shareAmount: number | null
  isActive: boolean
  startMonth: string // "YYYY-MM"
  ownerId: string
  ownerName: string
  isMine: boolean
  /** Nombre del otro miembro (para "¿Te pagó X?"). En las suyas = la dueña. */
  partnerName: string | null
}

export type ChargeRow = {
  subscriptionId: string
  month: string
  transactionId: string | null
  skipped: boolean
  ownerPaid: boolean
  partnerPaid: boolean
  ownerPaidByName: string | null
  partnerPaidByName: string | null
}

export type DueCharge = SubInfo & {
  monthKey: string
  monthLabel: string
  dateISO: string // fecha del cargo (día ajustado al mes)
  overdue: boolean
  confirmed: boolean
  ownerPaid: boolean
  partnerPaid: boolean
  ownerPaidByName: string | null
  partnerPaidByName: string | null
  /** Parte de la pareja ese mes (referencia para el check). */
  monthlyShare: number | null
}

export type MonthMark = {
  monthKey: string
  short: string // "sep"
  confirmed: boolean
  partnerPaid: boolean
  skipped: boolean
  isShared: boolean
}

export function monthKeyOf(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, '0')}`
}

export function monthLabelOf(key: string) {
  // Hora-muro (ver lib/walltime.ts): se construye en UTC para que el mes
  // nunca se desfase según el runtime (dev local o Vercel).
  const [y, m] = key.split('-').map(Number)
  return fmtMonthYear(utc(y, m - 1, 1))
}

export function monthShortOf(key: string) {
  const [y, m] = key.split('-').map(Number)
  return fmtMonthShort(utc(y, m - 1, 1))
}

/** Fecha del cargo: chargeDay ajustado al último día si el mes es más corto. */
export function chargeDate(monthKey: string, chargeDay: number): Date {
  const [y, m] = monthKey.split('-').map(Number)
  const last = daysInWallMonth(y, m - 1)
  return utc(y, m - 1, Math.min(Math.max(1, chargeDay), last), 12, 0, 0)
}

function eachMonth(fromKey: string, toKey: string): string[] {
  const [fy, fm] = fromKey.split('-').map(Number)
  const [ty, tm] = toKey.split('-').map(Number)
  const out: string[] = []
  let y = fy
  let m0 = fm - 1
  for (;;) {
    out.push(monthKeyOf(y, m0))
    if (y === ty && m0 === tm - 1) break
    const n = addWallMonths(y, m0, 1)
    y = n.y
    m0 = n.m0
  }
  return out
}

/**
 * Pendientes de una suscripción: meses sin fila de cargo (por confirmar) +
 * meses confirmados de compartidas sin el check de la pareja.
 * El mes en curso solo entra cuando ya pasó su fecha de cobro (chargeDay);
 * los meses omitidos ("no se cobró") no generan pendiente.
 */
export function computeDues(
  subs: SubInfo[],
  charges: Map<string, ChargeRow>, // `${subId}:${month}`
  now = wallNow(),
  lookbackMonths = 6,
): DueCharge[] {
  const dues: DueCharge[] = []
  const curKey = monthKeyOfWall(now)
  const min = addWallMonths(
    now.getUTCFullYear(),
    now.getUTCMonth() - lookbackMonths + 1,
    0,
  )
  const minKey = monthKeyOf(min.y, min.m0)
  const today = startOfWallDay(now)

  for (const s of subs) {
    if (!s.isActive) continue
    const from = s.startMonth > minKey ? s.startMonth : minKey
    const monthlyShare = s.isShared
      ? fromCents(
          s.shareAmount != null
            ? toCents(s.shareAmount)
            : Math.round((toCents(s.amount) * s.sharePct) / 100),
        )
      : null
    for (const key of eachMonth(from, curKey)) {
      const ch = charges.get(`${s.id}:${key}`)
      if (ch?.skipped) continue
      if (!ch) {
        const date = chargeDate(key, s.chargeDay)
        // El mes en curso avisa solo desde su fecha de cobro (inclusive).
        if (key === curKey) {
          const dayStart = startOfWallDay(date)
          if (dayStart > today) continue
        }
        dues.push({
          ...s,
          monthKey: key,
          monthLabel: monthLabelOf(key),
          dateISO: date.toISOString(),
          overdue: key < curKey,
          confirmed: false,
          ownerPaid: false,
          partnerPaid: false,
          ownerPaidByName: null,
          partnerPaidByName: null,
          monthlyShare,
        })
      } else if (s.isShared && !ch.partnerPaid) {
        const date = chargeDate(key, s.chargeDay)
        dues.push({
          ...s,
          monthKey: key,
          monthLabel: monthLabelOf(key),
          dateISO: date.toISOString(),
          overdue: key < curKey,
          confirmed: true,
          ownerPaid: ch.ownerPaid,
          partnerPaid: false,
          ownerPaidByName: ch.ownerPaidByName,
          partnerPaidByName: null,
          monthlyShare,
        })
      }
    }
  }

  return dues.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1))
}

/** Historial reciente (tira de meses) para la fila de cada suscripción. */
export function monthHistory(
  sub: SubInfo,
  charges: Map<string, ChargeRow>,
  now = wallNow(),
  count = 6,
): MonthMark[] {
  const out: MonthMark[] = []
  const base = addWallMonths(now.getUTCFullYear(), now.getUTCMonth(), 0)
  for (let i = count - 1; i >= 0; i--) {
    const dt = addWallMonths(base.y, base.m0, -i)
    const key = monthKeyOf(dt.y, dt.m0)
    const ch = charges.get(`${sub.id}:${key}`)
    out.push({
      monthKey: key,
      short: monthShortOf(key),
      confirmed: Boolean(ch && !ch.skipped),
      partnerPaid: ch?.partnerPaid ?? false,
      skipped: ch?.skipped ?? false,
      isShared: sub.isShared,
    })
  }
  return out
}

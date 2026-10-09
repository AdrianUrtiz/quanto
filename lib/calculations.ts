// Lógica de negocio: MSI + gastos compartidos 50/50.
//
// Reglas:
// - Una transacción tiene `amount` (total) e `installments` (1, 3, 6, 12).
// - Cuota mensual total = amount / installments.
// - Si isShared, se crea un TransactionShare con sharePct (default 50).
// - Aportación mensual del deudor = amount * sharePct/100 / installments.
//   Ej: $3,000 a 3 MSI, tarjeta de A, deudor B al 50% → $500/mes x 3 meses.
// - Una parcialidad "aplica" a un mes si: mes >= mes de compra y
//   mes < mes de compra + installments.

import { fromCents, toCents } from '@/lib/money'
import { isPendingId } from '@/lib/offline/pending'
import { installmentDate, periodContaining } from '@/lib/statements'
import { fmtMonthLong, monthKeyOfWall } from '@/lib/walltime'

export type ShareInput = {
  transactionId: string
  amount: number
  installments: number
  sharePct: number
  debtorId: string
  creatorId: string
  date: Date
}

export function monthlyTotal(amount: number, installments: number) {
  const n = Math.max(1, Math.round(installments))
  return fromCents(Math.round(toCents(amount) / n))
}

export function debtorMonthlyAmount(
  amount: number,
  installments: number,
  sharePct = 50,
) {
  const n = Math.max(1, Math.round(installments))
  const poolC = Math.round((toCents(amount) * sharePct) / 100)
  return fromCents(Math.round(poolC / n))
}

/** Meses (monthKey "YYYY-MM") en los que cae cada parcialidad. */
export function installmentMonths(start: Date, installments: number): string[] {
  // Hora-muro (ver lib/walltime.ts): todo en UTC = día real en México.
  const out: string[] = []
  const n = Math.max(1, Math.round(installments))
  const y = start.getUTCFullYear()
  const m0 = start.getUTCMonth()
  for (let i = 0; i < n; i++) {
    const t = m0 + i
    const ny = y + Math.floor(t / 12)
    const nm0 = ((t % 12) + 12) % 12
    out.push(`${ny}-${String(nm0 + 1).padStart(2, '0')}`)
  }
  return out
}

export type PayableInstallment = {
  /** Parcialidad 0-based (para mostrar i+1/n). */
  index: number
  /** Mes calendario de la compra: clave de registro del abono (no cambia). */
  payKey: string
  /** Mes en que se vuelve exigible: corte de la tarjeta o mes calendario. */
  dueKey: string
  /** Fecha límite de pago (solo crédito con día de pago). */
  dueDate: Date | null
}

/**
 * A qué mes se atribuye cada parcialidad en Pareja/Resumen.
 * - Crédito CON corte: la parcialidad cae al periodo del corte y se paga
 *   en el mes de su vencimiento (ej. compra 21 ago, corte 11 sep →
 *   exigible en septiembre, "para el 30 de septiembre").
 * - Débito o sin corte: mes calendario de la compra (comportamiento actual).
 * `payKey` nunca cambia: los abonos ya registrados siguen cuadrando.
 */
export function payableInstallments(
  date: Date,
  installments: number,
  statementDay?: number | null,
  dueDay?: number | null,
): PayableInstallment[] {
  const payKeys = installmentMonths(date, installments)
  // Sin corte no hay periodo que calcular: todo es mes calendario.
  if (statementDay == null || statementDay < 1 || statementDay > 31) {
    return payKeys.map((payKey, index) => ({
      index,
      payKey,
      dueKey: payKey,
      dueDate: null,
    }))
  }
  const opts = {
    statementDay: Math.round(statementDay),
    dueDay:
      dueDay != null && dueDay >= 1 && dueDay <= 31
        ? Math.round(dueDay)
        : null,
  }
  return payKeys.map((payKey, index) => {
    const period = periodContaining(installmentDate(date, index), opts)
    const dueDate = period.dueDate
    return {
      index,
      payKey,
      dueKey: dueDate ? monthKeyOfWall(dueDate) : monthKeyOfWall(period.end),
      dueDate,
    }
  })
}

/** "para el 30 de septiembre" a partir de una fecha de vencimiento. */
export function dueLabelFor(dueDate: Date): string {
  return `para el ${dueDate.getUTCDate()} de ${fmtMonthLong(dueDate)}`
}

export type SettlementLine = {
  debtorId: string
  creditorId: string
  debtorName: string
  creditorName: string
  amount: number // lo que debe aportar este mes
  details: {
    concept: string
    monthly: number
    installment: string
    /** Parcialidad de un eco local aún no subido. */
    pending?: boolean
  }[]
}

/**
 * Calcula "Cuentas por liquidar entre pareja" para un mes dado.
 * Entrada: transacciones del periodo con shares + creador.
 * `confirmed`: mapa opcional "shareId:month" → monto ya liquidado (se resta,
 * con month = mes de compra, la clave de registro del abono).
 * El mes objetivo es el de VENCIMIENTO (corte de la tarjeta en crédito
 * con corte; mes de compra en el resto), igual que en Pareja.
 */
export function settleMonth(
  txs: {
    id: string
    concept: string
    amount: number
    installments: number
    date: Date
    isShared: boolean
    createdById: string
    creatorName: string
    statementDay?: number | null
    dueDay?: number | null
    shares: {
      id: string
      debtorId: string
      debtorName: string
      sharePct: number
      monthlyAmount: number
    }[]
  }[],
  targetMonth: string,
  confirmed?: Map<string, number>,
): SettlementLine[] {
  const map = new Map<string, SettlementLine>()

  for (const tx of txs) {
    if (!tx.isShared) continue
    const parts = payableInstallments(
      new Date(tx.date),
      tx.installments,
      tx.statementDay,
      tx.dueDay,
    )

    for (const s of tx.shares) {
      if (s.debtorId === tx.createdById) continue // nadie se debe a sí mismo
      for (const p of parts) {
        if (p.dueKey !== targetMonth) continue
        const paidC = toCents(confirmed?.get(`${s.id}:${p.payKey}`) ?? 0)
        const restC = toCents(s.monthlyAmount) - paidC
        if (restC <= 0) continue // parcialidad ya liquidada
        const rest = fromCents(restC)
        const key = `${s.debtorId}->${tx.createdById}`
        const line =
          map.get(key) ??
          ({
            debtorId: s.debtorId,
            creditorId: tx.createdById,
            debtorName: s.debtorName,
            creditorName: tx.creatorName,
            amount: 0,
            details: [],
          } satisfies SettlementLine)
        line.amount = fromCents(toCents(line.amount) + restC)
        line.details.push({
          concept: tx.concept,
          monthly: rest,
          installment: `${p.index + 1}/${tx.installments}`,
          pending: isPendingId(tx.id),
        })
        map.set(key, line)
      }
    }
  }

  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

/** Disponible de una cuenta de crédito = límite - deuda. */
export function creditAvailable(limit: number, debt: number) {
  return fromCents(toCents(limit) - toCents(debt))
}

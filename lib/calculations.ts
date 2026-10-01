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

export type SettlementLine = {
  debtorId: string
  creditorId: string
  debtorName: string
  creditorName: string
  amount: number // lo que debe aportar este mes
  details: { concept: string; monthly: number; installment: string }[]
}

/**
 * Calcula "Cuentas por liquidar entre pareja" para un mes dado.
 * Entrada: transacciones del periodo con shares + creador.
 * `confirmed`: mapa opcional "shareId:month" → monto ya liquidado (se resta).
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
    const months = installmentMonths(new Date(tx.date), tx.installments)
    const idx = months.indexOf(targetMonth)
    if (idx === -1) continue

    for (const s of tx.shares) {
      if (s.debtorId === tx.createdById) continue // nadie se debe a sí mismo
      const paidC = toCents(confirmed?.get(`${s.id}:${targetMonth}`) ?? 0)
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
        installment: `${idx + 1}/${tx.installments}`,
      })
      map.set(key, line)
    }
  }

  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

/** Disponible de una cuenta de crédito = límite - deuda. */
export function creditAvailable(limit: number, debt: number) {
  return fromCents(toCents(limit) - toCents(debt))
}

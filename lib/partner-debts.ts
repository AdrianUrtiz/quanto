import { installmentMonths } from '@/lib/calculations'
import type { LineSums } from '@/lib/debt-payments'

export type DebtLine = {
  concept: string
  monthly: number
  installment: number // parcialidad que cae este mes (1-based)
  installments: number // total de parcialidades
  shareId: string | null // null en modo demo (sin pagos)
  month: string // "YYYY-MM" de la parcialidad
  paid: number // suma CONFIRMED
  pending: number // suma PENDING
}

/** Deuda entre pareja este mes, agrupada por cuenta. Si debtorId soy yo, la debo;
 * si no, me la deben. `total` = mensualidades originales; `remaining` = por pagar. */
export type PartnerDebt = {
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  dueDay?: number
  debtorId: string
  debtorName: string
  creditorName: string
  total: number
  remaining: number
  lines: DebtLine[]
}

/** Entrada serializable (fecha ISO) para agrupar deudas de un mes. */
export type DebtItemInput = {
  shareId: string
  accountId: string
  accountName: string
  accountType: 'DEBIT' | 'CREDIT'
  dueDay?: number
  debtorId: string
  debtorName: string
  creditorName: string
  concept: string
  monthly: number
  installments: number
  date: string // ISO
}

/**
 * Agrupa por cuenta+deudor solo lo exigible en el mes `key`.
 * Si la compra fue a MSI, únicamente cae la parcialidad del periodo actual.
 */
export function buildDebts(
  items: DebtItemInput[],
  key: string,
  sums: Map<string, LineSums>,
): PartnerDebt[] {
  const byAcc = new Map<string, PartnerDebt>()
  for (const it of items) {
    const months = installmentMonths(new Date(it.date), it.installments)
    const idx = months.indexOf(key)
    if (idx === -1) continue // fuera del periodo actual
    const gk = `${it.accountId}:${it.debtorId}`
    const g = byAcc.get(gk) ?? {
      accountId: it.accountId,
      accountName: it.accountName,
      accountType: it.accountType,
      dueDay: it.dueDay,
      debtorId: it.debtorId,
      debtorName: it.debtorName,
      creditorName: it.creditorName,
      total: 0,
      remaining: 0,
      lines: [],
    }
    g.total += it.monthly
    const s = sums.get(`${it.shareId}:${key}`) ?? { confirmed: 0, pending: 0 }
    g.remaining += Math.max(0, it.monthly - s.confirmed)
    g.lines.push({
      concept: it.concept,
      monthly: it.monthly,
      installment: idx + 1,
      installments: it.installments,
      shareId: it.shareId || null,
      month: key,
      paid: s.confirmed,
      pending: s.pending,
    })
    byAcc.set(gk, g)
  }
  return [...byAcc.values()].sort((a, b) => b.remaining - a.remaining)
}

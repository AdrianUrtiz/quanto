import {
  dueLabelFor,
  payableInstallments,
} from '@/lib/calculations'
import type { LineSums } from '@/lib/debt-payments'
import { fromCents, toCents } from '@/lib/money'

export type DebtLine = {
  concept: string
  monthly: number
  installment: number // parcialidad que cae este mes (1-based)
  installments: number // total de parcialidades
  shareId: string | null // null en modo demo (sin pagos)
  month: string // "YYYY-MM" de la parcialidad: clave de registro del abono
  paid: number // suma CONFIRMED
  pending: number // suma PENDING
}

/** Deuda entre pareja este mes, agrupada por cuenta. Si debtorId soy yo, la debo;
 * si no, me la deben. `total` = mensualidades originales; `remaining` = por pagar.
 * `dueLabel` = fecha real de pago según el corte ("para el 30 de septiembre"). */
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
  dueLabel?: string | null
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
  /** Día de corte de la tarjeta (solo crédito). Sin corte: mes calendario. */
  statementDay?: number | null
}

/**
 * Agrupa por cuenta+deudor solo lo exigible en el mes `key` (mes de
 * vencimiento para crédito con corte, mes de compra en el resto).
 * Si la compra fue a MSI, únicamente cae la parcialidad del periodo actual.
 */
export function buildDebts(
  items: DebtItemInput[],
  key: string,
  sums: Map<string, LineSums>,
): PartnerDebt[] {
  const byAcc = new Map<string, PartnerDebt>()
  for (const it of items) {
    const date = new Date(it.date)
    const parts = payableInstallments(
      date,
      it.installments,
      it.statementDay,
      it.dueDay,
    )
    for (const p of parts) {
      if (p.dueKey !== key) continue // fuera del periodo actual
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
        dueLabel: null,
        lines: [],
      }
      g.total = fromCents(toCents(g.total) + toCents(it.monthly))
      const s = sums.get(`${it.shareId}:${p.payKey}`) ?? {
        confirmed: 0,
        pending: 0,
      }
      g.remaining = fromCents(
        toCents(g.remaining) +
          Math.max(0, toCents(it.monthly) - toCents(s.confirmed)),
      )
      if (g.dueLabel == null && p.dueDate) g.dueLabel = dueLabelFor(p.dueDate)
      g.lines.push({
        concept: it.concept,
        monthly: it.monthly,
        installment: p.index + 1,
        installments: it.installments,
        shareId: it.shareId || null,
        month: p.payKey,
        paid: s.confirmed,
        pending: s.pending,
      })
      byAcc.set(gk, g)
    }
  }
  return [...byAcc.values()].sort((a, b) => b.remaining - a.remaining)
}

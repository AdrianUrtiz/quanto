import { fromCents, toCents } from '@/lib/money'

// Sugerencia de pagos para liquidar un grupo (neteo de saldos).
// La primera parte es pura y testeable; al final, helpers con DB.

export type BalanceInput = {
  id: string
  name: string
  /** Pagado − consumido. > 0 = le deben, < 0 = debe. */
  balance: number
}

export type SuggestedTransfer = {
  fromId: string
  fromName: string
  toId: string
  toName: string
  amount: number
}

/**
 * Totales por deudor/acreedor: empareja al que más debe con al que más se
 * le debe hasta saldar todo. Minimiza el número de transferencias.
 * Todo en centavos para no arrastrar decimales.
 */
export function suggestSettlements(
  members: BalanceInput[],
): SuggestedTransfer[] {
  const debtors = members
    .map((m) => ({ ...m, cents: toCents(m.balance) }))
    .filter((m) => m.cents < 0)
    .map((m) => ({ ...m, cents: -m.cents }))
    .sort((a, b) => b.cents - a.cents)
  const creditors = members
    .map((m) => ({ ...m, cents: toCents(m.balance) }))
    .filter((m) => m.cents > 0)
    .sort((a, b) => b.cents - a.cents)

  const out: SuggestedTransfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]
    const c = creditors[j]
    const amt = Math.min(d.cents, c.cents)
    if (amt <= 0) break
    out.push({
      fromId: d.id,
      fromName: d.name,
      toId: c.id,
      toName: c.name,
      amount: fromCents(amt),
    })
    d.cents -= amt
    c.cents -= amt
    if (d.cents <= 0) i++
    if (c.cents <= 0) j++
  }
  return out
}

export type SeatNet = {
  seatId: string
  userId: string | null
  displayName: string
  paid: number
  consumed: number
  settledOut: number
  settledIn: number
  /** paid − consumed + settledOut − settledIn, en centavos exactos. */
  netCents: number
}

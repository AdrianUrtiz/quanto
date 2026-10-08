// Servidor: candidatos para el recordatorio "Pagar tus tarjetas".
//
// Por cada crédito propio con día límite de pago (tenga o no corte):
// - Periodos vencidos sin liquidar (cierre > 0 y límite ya pasado).
// - Más el periodo vigente a pagar (aunque aún no esté en hito: el
//   cliente filtra 3/1/0 y el descarte).
// El cliente elige qué mostrar (vencido más antiguo o vigente en hito).
import type { CardPayCandidate } from '@/lib/card-pay'
import { toCents } from '@/lib/money'
import { normalizeMoney } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { type StatementTx, activePeriods } from '@/lib/statements'
import { startOfWallDay, utc, wallNow } from '@/lib/walltime'

/** Candidatos serializables para CardPayReminders (cierre > 0). */
export async function getCardPayCandidates(
  userId: string,
  now = wallNow(),
): Promise<CardPayCandidate[]> {
  if (!userId) return []
  const cards = await prisma.account.findMany({
    where: {
      userId,
      isActive: true,
      isHidden: false,
      type: 'CREDIT',
      dueDay: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (cards.length === 0) return []
  const ids = cards.map((c) => c.id)
  // Ventana amplia para no perder MSI largos en la siembra de saldos.
  const stmtStart = utc(now.getUTCFullYear(), now.getUTCMonth() - 30, 1)
  const rows = await prisma.transaction.findMany({
    where: {
      date: { gte: stmtStart },
      OR: [{ accountId: { in: ids } }, { transferToAccountId: { in: ids } }],
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  const today = startOfWallDay(now).getTime()
  const out: CardPayCandidate[] = []
  for (const c of cards) {
    const txs: StatementTx[] = rows
      .filter((t) => t.accountId === c.id || t.transferToAccountId === c.id)
      .map((t) => ({
        id: t.id,
        type: t.type as 'EXPENSE' | 'INCOME' | 'TRANSFER',
        amount: normalizeMoney(t.amount),
        concept: t.concept,
        date: t.date,
        accountId: t.accountId,
        transferToAccountId: t.transferToAccountId,
        installments: t.installments,
        statementKey: t.statementKey ?? null,
      }))
    const { statements, currentKey } = activePeriods(
      c.id,
      txs,
      { statementDay: c.statementDay, dueDay: c.dueDay },
      now,
    )
    const toCandidate = (p: (typeof statements)[number]): CardPayCandidate => ({
      cardId: c.id,
      cardName: c.name,
      lastFour: c.lastFour,
      closing: p.closing,
      dueDateISO: p.dueDate!.toISOString(),
      periodKey: p.key,
      periodLabel: p.label,
      dueLabel: p.dueLabel,
      isCurrent: p.key === currentKey,
    })
    // Vencidos sin liquidar (el cliente muestra el más antiguo, a diario).
    const overdue = statements
      .filter(
        (p) =>
          p.dueDate &&
          startOfWallDay(p.dueDate).getTime() < today &&
          toCents(p.closing) > 0,
      )
      .sort((a, b) => a.end.getTime() - b.end.getTime())
    for (const p of overdue) out.push(toCandidate(p))
    // Vigente a pagar (el cliente lo muestra solo en 3/1/0).
    const cur = statements.find((p) => p.key === currentKey)
    if (
      cur?.dueDate &&
      toCents(cur.closing) > 0 &&
      !overdue.some((p) => p.key === cur.key)
    )
      out.push(toCandidate(cur))
  }
  return out
}

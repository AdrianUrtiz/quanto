'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { checkCategory } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import type { SeatNet } from '@/lib/group-settle'
import { fromCents, moneySchema, toCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { formatMoney } from '@/lib/utils'
import { wallNow } from '@/lib/walltime'

import { auth } from '@/auth'

function meIdOf(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null
}

function revalidateGroups() {
  revalidatePath('/cuentas')
  revalidatePath('/actividad')
  revalidatePath('/resumen')
  revalidatePath('/cuentas/grupos')
}

async function seatNetDebit(
  householdId: string,
  seatId: string,
): Promise<number> {
  const nets = await getGroupNets(householdId)
  const net = nets.get(seatId)?.netCents ?? 0
  return Math.max(0, -net)
}

const RegisterSchema = z.object({
  householdId: z.string().min(1),
  fromSeatId: z.string().min(1),
  toSeatId: z.string().min(1),
  amount: moneySchema,
  accountId: z.string().optional(),
})

/**
 * Registra una transferencia neteada entre dos seats.
 * - Si registra quien RECIBE (ocupa toSeat): CONFIRMED + ingreso en su cuenta.
 * - Si registra quien PAGA (ocupa fromSeat): PENDING + egreso opcional propio.
 * El monto se topa a lo que el deudor debe en neto.
 */
export async function registerSettlement(input: {
  householdId: string
  fromSeatId: string
  toSeatId: string
  amount: number
  accountId?: string
}) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const parsed = RegisterSchema.safeParse(input)
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data
  if (v.fromSeatId === v.toSeatId)
    return { error: 'Elige dos integrantes distintos' }

  const household = await prisma.household.findUnique({
    where: { id: v.householdId },
    select: { kind: true, status: true, name: true },
  })
  if (!household || household.kind !== 'GROUP')
    return { error: 'Grupo no encontrado' }
  if (household.status !== 'ACTIVE') return { error: 'Este grupo está cerrado' }

  const [fromSeat, toSeat] = await Promise.all([
    prisma.householdMember.findFirst({
      where: { id: v.fromSeatId, householdId: v.householdId },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.householdMember.findFirst({
      where: { id: v.toSeatId, householdId: v.householdId },
      include: { user: { select: { id: true, name: true } } },
    }),
  ])
  if (!fromSeat || !toSeat)
    return { error: 'Algún integrante ya no está en el grupo' }

  const iAmFrom = fromSeat.userId === userId
  const iAmTo = toSeat.userId === userId
  if (!iAmFrom && !iAmTo) return { error: 'No participas en esta liquidación' }

  const rest = await seatNetDebit(v.householdId, v.fromSeatId)
  if (toCents(v.amount) - rest > 0) {
    return { error: `Solo restan ${formatMoney(fromCents(rest))}` }
  }

  const groupName = household.name ?? 'el grupo'
  if (iAmTo) {
    // Recibe: confirmado + ingreso inmediato.
    if (!v.accountId) return { error: 'Elige la cuenta donde recibiste' }
    const account = await prisma.account.findFirst({
      where: { id: v.accountId, userId },
    })
    if (!account) return { error: 'Cuenta no encontrada' }
    const catError = await checkCategory(userId, 'TRANSFERENCIA', 'INCOME')
    if (catError) return { error: catError }
    const income = await prisma.transaction.create({
      data: {
        type: 'INCOME',
        amount: v.amount,
        concept: `Liquidación ${groupName} ← ${fromSeat.displayName}`,
        category: 'TRANSFERENCIA',
        date: wallNow(),
        accountId: v.accountId,
        createdById: userId,
        installments: 1,
        isShared: false,
      },
    })
    await prisma.groupSettlement.create({
      data: {
        householdId: v.householdId,
        fromSeatId: v.fromSeatId,
        toSeatId: v.toSeatId,
        amount: v.amount,
        status: 'CONFIRMED',
        registeredById: userId,
        confirmedById: userId,
        accountId: v.accountId,
        transactionId: income.id,
      },
    })
    revalidateGroups()
    return { ok: true as const }
  }

  // Paga: pendiente + egreso opcional propio.
  let expenseId: string | null = null
  let expenseAccountId: string | null = null
  if (v.accountId) {
    const account = await prisma.account.findFirst({
      where: { id: v.accountId, userId },
      select: { id: true },
    })
    if (!account) return { error: 'Cuenta no encontrada' }
    const catError = await checkCategory(userId, 'OTRO', 'EXPENSE')
    if (catError) return { error: catError }
    const expense = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: v.amount,
        concept: `Liquidación ${groupName} → ${toSeat.displayName}`,
        category: 'OTRO',
        date: wallNow(),
        accountId: v.accountId,
        createdById: userId,
        installments: 1,
        isShared: false,
      },
    })
    expenseId = expense.id
    expenseAccountId = v.accountId
  }
  await prisma.groupSettlement.create({
    data: {
      householdId: v.householdId,
      fromSeatId: v.fromSeatId,
      toSeatId: v.toSeatId,
      amount: v.amount,
      status: 'PENDING',
      registeredById: userId,
      accountId: expenseAccountId,
      transactionId: expenseId,
    },
  })
  revalidateGroups()
  return { ok: true as const }
}

/**
 * El acreedor confirma una liquidación registrada por el deudor.
 * Crea el ingreso en SU propia cuenta (la elige al confirmar).
 */
export async function confirmSettlement(
  settlementId: string,
  accountId: string,
) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }
  if (!accountId) return { error: 'Elige la cuenta donde recibiste' }

  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  })
  if (!account) return { error: 'Cuenta no encontrada' }

  try {
    await prisma.$transaction(async (db) => {
      const st = await db.groupSettlement.findUnique({
        where: { id: settlementId },
        include: {
          household: { select: { kind: true, status: true, name: true } },
          fromSeat: {
            select: {
              id: true,
              userId: true,
              displayName: true,
              householdId: true,
            },
          },
          toSeat: { select: { id: true, userId: true } },
        },
      })
      if (!st) throw new Error('Liquidación no encontrada')
      if (st.status !== 'PENDING')
        throw new Error('Esta liquidación ya fue atendida')
      if (st.household.kind !== 'GROUP')
        throw new Error('Liquidación no encontrada')
      if (st.household.status !== 'ACTIVE')
        throw new Error('Este grupo está cerrado')
      if (st.toSeat.userId !== userId)
        throw new Error('Solo quien recibe puede confirmar')
      if (st.registeredById === userId)
        throw new Error('No puedes confirmar tu propio registro')

      const rest = await seatNetDebit(st.householdId, st.fromSeatId)
      if (toCents(st.amount) - rest > 0) {
        throw new Error(`Solo restan ${formatMoney(fromCents(rest))}`)
      }

      const catError = await checkCategory(userId, 'TRANSFERENCIA', 'INCOME')
      if (catError) throw new Error(catError)
      const income = await db.transaction.create({
        data: {
          type: 'INCOME',
          amount: st.amount,
          concept: `Liquidación ${st.household.name ?? 'el grupo'} ← ${st.fromSeat.displayName}`,
          category: 'TRANSFERENCIA',
          date: wallNow(),
          accountId: account.id,
          createdById: userId,
          installments: 1,
          isShared: false,
        },
      })
      await db.groupSettlement.update({
        where: { id: st.id },
        data: {
          status: 'CONFIRMED',
          confirmedById: userId,
          accountId: account.id,
          transactionId: income.id,
          // Si el deudor ya indicó origen al registrar, se conserva.
          ...(st.registeredById !== userId && st.accountId
            ? {
                debtorAccountId: st.accountId,
                debtorTransactionId: st.transactionId,
                debtorConfirmedAt: wallNow(),
              }
            : {}),
        },
      })
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo confirmar' }
  }
  revalidateGroups()
  return { ok: true as const }
}

/** El registrante cancela su propia liquidación pendiente. */
export async function cancelSettlement(settlementId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const st = await prisma.groupSettlement.findUnique({
    where: { id: settlementId },
  })
  if (!st) return { error: 'Liquidación no encontrada' }
  if (st.registeredById !== userId)
    return { error: 'Solo quien registró puede cancelar' }
  if (st.status !== 'PENDING')
    return { error: 'Solo se puede cancelar una liquidación pendiente' }
  await prisma.$transaction(async (db) => {
    await db.groupSettlement.delete({ where: { id: st.id } })
    if (st.transactionId) {
      await db.transaction.deleteMany({ where: { id: st.transactionId } })
    }
  })
  revalidateGroups()
  return { ok: true as const }
}

/** El acreedor rechaza una liquidación pendiente del deudor. */
export async function rejectSettlement(settlementId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const st = await prisma.groupSettlement.findUnique({
    where: { id: settlementId },
    include: { toSeat: { select: { userId: true } } },
  })
  if (!st) return { error: 'Liquidación no encontrada' }
  if (st.status !== 'PENDING')
    return { error: 'Esta liquidación ya fue atendida' }
  if (st.toSeat.userId !== userId || st.registeredById === userId) {
    return { error: 'Solo quien recibe puede rechazar' }
  }
  await prisma.$transaction(async (db) => {
    await db.groupSettlement.delete({ where: { id: st.id } })
    if (st.transactionId) {
      await db.transaction.deleteMany({ where: { id: st.transactionId } })
    }
  })
  revalidateGroups()
  return { ok: true as const }
}

export type SettlementRow = {
  id: string
  amount: number
  fromSeatId: string
  fromName: string
  toSeatId: string
  toName: string
  isMineFrom: boolean
  registeredByName: string
}

/** Liquidaciones PENDING del grupo donde participo (para confirmar/cancelar). */
export async function getGroupSettlementPendings(
  householdId: string,
  userId: string,
): Promise<{ toConfirm: SettlementRow[]; myPending: SettlementRow[] }> {
  if (!process.env.DATABASE_URL) return { toConfirm: [], myPending: [] }
  const rows = await prisma.groupSettlement.findMany({
    where: { householdId, status: 'PENDING' },
    include: {
      fromSeat: { select: { id: true, userId: true, displayName: true } },
      toSeat: { select: { id: true, userId: true, displayName: true } },
      registeredBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const toConfirm: SettlementRow[] = []
  const myPending: SettlementRow[] = []
  for (const r of rows) {
    const row: SettlementRow = {
      id: r.id,
      amount: Number(r.amount),
      fromSeatId: r.fromSeatId,
      fromName: r.fromSeat.displayName,
      toSeatId: r.toSeatId,
      toName: r.toSeat.displayName,
      isMineFrom: r.fromSeat.userId === userId,
      registeredByName: r.registeredBy.name,
    }
    if (r.registeredById === userId) myPending.push(row)
    else if (r.toSeat.userId === userId) toConfirm.push(row)
  }
  return { toConfirm, myPending }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Neteo por seat: lo pagado menos lo consumido, ajustado por liquidaciones
 * CONFIRMED. Todo en centavos enteros para que la suma dé cero exacto.
 */
export async function getGroupNets(
  householdId: string,
): Promise<Map<string, SeatNet>> {
  const [members, txs, settlements] = await Promise.all([
    prisma.householdMember.findMany({
      where: { householdId },
      select: { id: true, userId: true, displayName: true },
    }),
    prisma.transaction.findMany({
      where: { householdId, type: 'EXPENSE' },
      include: {
        shares: { select: { id: true, seatId: true, monthlyAmount: true } },
      },
    }),
    prisma.groupSettlement.findMany({
      where: { householdId, status: 'CONFIRMED' },
      select: { fromSeatId: true, toSeatId: true, amount: true },
    }),
  ])
  const nets = new Map<string, SeatNet>()
  for (const m of members) {
    nets.set(m.id, {
      seatId: m.id,
      userId: m.userId,
      displayName: m.displayName,
      paid: 0,
      consumed: 0,
      settledOut: 0,
      settledIn: 0,
      netCents: 0,
    })
  }
  for (const t of txs) {
    const payer =
      members.find((m) => m.id === t.paidBySeatId) ??
      members.find((m) => m.userId === t.createdById)
    if (payer) {
      const row = nets.get(payer.id)!
      row.paid = round2(row.paid + Number(t.amount))
    }
    // Las mensualidades se multiplican por los meses: lo consumido y los
    // nets son totales (igual que el monto pagado).
    const n = Math.max(1, Math.round(t.installments))
    let debtorSumC = 0
    for (const s of t.shares) {
      if (!s.seatId) continue
      const row = nets.get(s.seatId)
      if (row) {
        row.consumed = round2(row.consumed + Number(s.monthlyAmount) * n)
        debtorSumC += toCents(Number(s.monthlyAmount)) * n
      }
    }
    // Lo consumido por quien pagó (total − partes): sin esto el pagador
    // queda con saldo inflado y las sugerencias salen mal.
    const portionC = Math.max(0, toCents(Number(t.amount)) - debtorSumC)
    if (payer && portionC > 0) {
      const row = nets.get(payer.id)!
      row.consumed = round2(row.consumed + portionC / 100)
    }
  }
  // Pagos por línea confirmados legacy (hoy bloqueados en grupos): reducen
  // lo consumido pendiente, igual que una liquidación.
  const allShareIds = txs.flatMap((t) => t.shares.map((s) => s.id))
  if (allShareIds.length > 0) {
    const sums = await getLineSums(allShareIds)
    const confirmedByShare = new Map<string, number>()
    for (const [key, sm] of sums) {
      const sep = key.lastIndexOf(':')
      const sid = sep >= 0 ? key.slice(0, sep) : key
      confirmedByShare.set(sid, (confirmedByShare.get(sid) ?? 0) + sm.confirmed)
    }
    for (const t of txs) {
      for (const s of t.shares) {
        if (!s.seatId) continue
        const row = nets.get(s.seatId)
        const c = confirmedByShare.get(s.id) ?? 0
        if (row && c > 0) row.consumed = round2(row.consumed - c)
      }
    }
  }
  for (const st of settlements) {
    const from = nets.get(st.fromSeatId)
    const to = nets.get(st.toSeatId)
    const amt = Number(st.amount)
    if (from) from.settledOut = round2(from.settledOut + amt)
    if (to) to.settledIn = round2(to.settledIn + amt)
  }
  // Pagar reduce lo que debes (net menos negativo); cobrar reduce lo que
  // te deben (net menos positivo).
  for (const row of nets.values()) {
    row.netCents =
      toCents(row.paid) -
      toCents(row.consumed) +
      toCents(row.settledOut) -
      toCents(row.settledIn)
  }
  return nets
}

/** Total aún por liquidar (suma de nets positivos, en centavos). */
export async function groupOutstandingCents(
  householdId: string,
): Promise<number> {
  const nets = await getGroupNets(householdId)
  let rest = 0
  for (const row of nets.values()) {
    if (row.netCents > 0) rest += row.netCents
  }
  return rest
}

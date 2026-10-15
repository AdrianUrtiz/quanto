'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { payableInstallments } from '@/lib/calculations'
import { checkCategory } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { getGroupNets, groupOutstandingCents } from '@/lib/group-settlements'
import {
  type SettlementRow,
  getGroupSettlementPendings,
} from '@/lib/group-settlements'
import { newGroupCode, normalizeCode } from '@/lib/households'
import { fromCents, moneySchema, toCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { monthLabelEs } from '@/lib/utils'
import { parseWallInput } from '@/lib/walltime'

import { auth } from '@/auth'

function meIdOf(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null
}

type GroupHousehold = {
  id: string
  name: string | null
  code: string | null
  status: 'ACTIVE' | 'CLOSED'
  createdById: string
}

/** Household GROUP existente o mensaje de error. */
async function getGroupHousehold(
  householdId: string,
): Promise<{ error: string } | { household: GroupHousehold }> {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: {
      id: true,
      name: true,
      code: true,
      kind: true,
      status: true,
      createdById: true,
    },
  })
  if (!household || household.kind !== 'GROUP')
    return { error: 'Grupo no encontrado' }
  return {
    household: {
      id: household.id,
      name: household.name,
      code: household.code,
      status: household.status,
      createdById: household.createdById,
    },
  }
}

/** Total aún por liquidar en NETO (para cerrar/eliminar). */
async function groupOutstanding(householdId: string): Promise<number> {
  return (await groupOutstandingCents(householdId)) / 100
}

function revalidateAll() {
  revalidatePath('/cuentas')
  revalidatePath('/actividad')
  revalidatePath('/resumen')
  revalidatePath('/cuentas/grupos')
  revalidatePath('/ajustes')
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().replace(/\s+/g, ' ')
  if (v.length < 1 || v.length > 30) return null
  return v
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out
}

async function uniqueGroupCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = newGroupCode()
    const existing = await prisma.household.findUnique({
      where: { code },
      select: { id: true },
    })
    if (!existing) return code
  }
  throw new Error('No se pudo generar el código del grupo')
}

/** Crear grupo con seats por nombre libre ("Brenda, Luis, Toño, Kari"). */
export async function createGroup(formData: FormData) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const name = cleanName(formData.get('name'))
  if (!name) return { error: 'Ponle un nombre al grupo' }
  const rawSeats = String(formData.get('seats') ?? '')
    .split(/[\n,]/)
    .map((s) => cleanName(s))
    .filter((s): s is string => s != null)
  const seats = dedupeNames(rawSeats)
  if (seats.length === 0) return { error: 'Agrega al menos un integrante' }
  if (seats.length > 50) return { error: 'Máximo 50 integrantes por grupo' }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  const myName = me?.name ?? 'Yo'
  // El creador siempre es miembro ocupado (si su nombre ya está en la lista,
  // se reclama ese seat en vez de duplicarlo).
  const myIdx = seats.findIndex((s) => s.toLowerCase() === myName.toLowerCase())

  const code = await uniqueGroupCode()
  const household = await prisma.$transaction(async (db) => {
    const h = await db.household.create({
      data: { kind: 'GROUP', name, code, createdById: userId },
    })
    await db.householdMember.createMany({
      data: seats.map((displayName, i) =>
        i === myIdx
          ? { householdId: h.id, displayName, userId }
          : { householdId: h.id, displayName },
      ),
    })
    if (myIdx === -1) {
      await db.householdMember.create({
        data: { householdId: h.id, displayName: myName, userId },
      })
    }
    return h
  })

  revalidateAll()
  return { ok: true as const, householdId: household.id, code }
}

export type GroupPreview = {
  householdId: string
  name: string
  code: string
  memberCount: number
  seats: { id: string; displayName: string; occupied: boolean }[]
}

/** Vista previa sin montos: muestra el grupo y pregunta quién eres. */
export async function previewGroup(
  rawCode: string,
): Promise<{ error: string } | (GroupPreview & { ok: true })> {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  const code = normalizeCode(rawCode)
  if (!code || !code.startsWith('G-'))
    return { error: 'Código inválido (G-XXXXXX)' }

  const h = await prisma.household.findUnique({
    where: { code },
    include: {
      members: {
        select: { id: true, displayName: true, userId: true },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })
  if (!h || h.kind !== 'GROUP') return { error: 'No encontramos ese grupo' }
  const already = h.members.some((m) => m.userId === userId)

  return {
    ok: true,
    householdId: h.id,
    name: h.name ?? 'Grupo',
    code: h.code ?? code,
    memberCount: h.members.length,
    seats: h.members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      occupied: m.userId != null,
    })),
    ...(already ? { alreadyMember: true as const } : {}),
  }
}

/** Reclamar un seat libre (claim atómico: solo el primero gana). */
export async function claimSeat(memberId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const seat = await prisma.householdMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      householdId: true,
      userId: true,
      displayName: true,
      household: { select: { kind: true, status: true } },
    },
  })
  if (!seat || seat.household.kind !== 'GROUP')
    return { error: 'Lugar no encontrado' }
  if (seat.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }
  if (seat.userId) {
    if (seat.userId === userId) return { ok: true as const }
    return { error: 'Ese lugar ya fue tomado' }
  }
  const existing = await prisma.householdMember.findFirst({
    where: { householdId: seat.householdId, userId },
    select: { id: true },
  })
  if (existing) return { error: 'Ya eres parte de este grupo' }

  try {
    await prisma.$transaction(async (db) => {
      const claimed = await db.householdMember.updateMany({
        where: { id: seat.id, userId: null },
        data: { userId },
      })
      if (claimed.count === 0) throw new Error('Ese lugar ya fue tomado')
      // Dual-write: los shares del seat apuntan al reclamante.
      await db.transactionShare.updateMany({
        where: { seatId: seat.id },
        data: { debtorId: userId },
      })
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'Ese lugar ya fue tomado')
      return { error: e.message }
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === 'P2002'
    ) {
      return { error: 'Ya eres parte de este grupo' }
    }
    throw e
  }

  revalidateAll()
  return { ok: true as const }
}

/** Entrar con mi propio nombre cuando no estoy en la lista. */
export async function joinGroupAsNew(rawCode: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }
  const code = normalizeCode(rawCode)
  if (!code || !code.startsWith('G-'))
    return { error: 'Código inválido (G-XXXXXX)' }

  const h = await prisma.household.findUnique({
    where: { code },
    select: { id: true, kind: true, status: true },
  })
  if (!h || h.kind !== 'GROUP') return { error: 'No encontramos ese grupo' }
  if (h.status !== 'ACTIVE') return { error: 'Este grupo está cerrado' }
  const existing = await prisma.householdMember.findFirst({
    where: { householdId: h.id, userId },
    select: { id: true },
  })
  if (existing) return { ok: true as const }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  const displayName = (me?.name ?? 'Yo').trim()
  const clash = await prisma.householdMember.findFirst({
    where: { householdId: h.id, displayName },
    select: { id: true, userId: true },
  })
  if (clash) {
    if (!clash.userId) {
      // Mi nombre coincide con un seat libre → reclamarlo es lo esperado.
      return claimSeat(clash.id)
    }
    return { error: 'Ese nombre ya está ocupado en el grupo' }
  }

  try {
    await prisma.householdMember.create({
      data: { householdId: h.id, displayName, userId },
    })
  } catch (e) {
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === 'P2002'
    ) {
      return { error: 'Ya eres parte de este grupo' }
    }
    throw e
  }
  revalidateAll()
  return { ok: true as const }
}

/** ¿El grupo ya tiene gastos? Si sí, los nombres quedan fijos (historia). */
async function groupHasExpenses(householdId: string): Promise<boolean> {
  const n = await prisma.transaction.count({
    where: { householdId, type: 'EXPENSE' },
  })
  return n > 0
}

/** Añadir UN integrante (solo el creador). Un clic = una persona. */
export async function addGroupSeat(householdId: string, rawName: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }
  const h = await prisma.household.findUnique({
    where: { id: householdId },
    select: { id: true, kind: true, status: true, createdById: true },
  })
  if (!h || h.kind !== 'GROUP') return { error: 'Grupo no encontrado' }
  if (h.status !== 'ACTIVE') return { error: 'Este grupo está cerrado' }
  if (h.createdById !== userId)
    return { error: 'Solo el creador añade integrantes' }

  const name = cleanName(rawName)
  if (!name) return { error: 'Escribe un nombre (1-30 letras)' }

  const clash = await prisma.householdMember.findFirst({
    where: { householdId, displayName: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (clash) return { error: 'Ese nombre ya está en el grupo' }

  try {
    await prisma.householdMember.create({
      data: { householdId, displayName: name },
    })
  } catch (e) {
    if (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === 'P2002'
    ) {
      return { error: 'Ese nombre ya está en el grupo' }
    }
    throw e
  }
  revalidateAll()
  return { ok: true as const }
}

/** Renombrar un integrante (solo el creador, solo sin gastos registrados). */
export async function renameGroupSeat(memberId: string, rawName: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }
  const name = cleanName(rawName)
  if (!name) return { error: 'Nombre inválido' }

  const seat = await prisma.householdMember.findUnique({
    where: { id: memberId },
    include: {
      household: { select: { kind: true, status: true, createdById: true } },
    },
  })
  if (!seat || seat.household.kind !== 'GROUP')
    return { error: 'Lugar no encontrado' }
  if (seat.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }
  if (seat.household.createdById !== userId)
    return { error: 'Solo el creador renombra integrantes' }
  if (await groupHasExpenses(seat.householdId))
    return { error: 'Ya hay gastos: los nombres quedan fijos' }

  const clash = await prisma.householdMember.findFirst({
    where: {
      householdId: seat.householdId,
      displayName: { equals: name, mode: 'insensitive' },
      id: { not: seat.id },
    },
    select: { id: true },
  })
  if (clash) return { error: 'Ese nombre ya está en el grupo' }

  await prisma.householdMember.update({
    where: { id: seat.id },
    data: { displayName: name },
  })
  revalidateAll()
  return { ok: true as const }
}

/** Eliminar un integrante (solo el creador, solo sin gastos registrados). */
export async function removeGroupSeat(memberId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const seat = await prisma.householdMember.findUnique({
    where: { id: memberId },
    include: {
      household: { select: { kind: true, status: true, createdById: true } },
    },
  })
  if (!seat || seat.household.kind !== 'GROUP')
    return { error: 'Lugar no encontrado' }
  if (seat.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }
  if (seat.household.createdById !== userId)
    return { error: 'Solo el creador elimina integrantes' }
  if (seat.userId === userId)
    return { error: 'No puedes eliminarte a ti mismo del grupo' }
  if (await groupHasExpenses(seat.householdId))
    return { error: 'Ya hay gastos: los nombres quedan fijos' }

  await prisma.householdMember.delete({ where: { id: seat.id } })
  revalidateAll()
  return { ok: true as const }
}

const GroupExpenseSchema = z.object({
  householdId: z.string().min(1),
  // Seat que pagó (por defecto el mío; puede ser otro integrante).
  payerSeatId: z.string().min(1),
  // Solo cuando pago yo: de qué cuenta mía salió.
  accountId: z.string().optional(),
  amount: moneySchema,
  concept: z.string().min(2, 'Agrega un concepto'),
  category: z.string().default('OTRO'),
  date: z.string(),
  splitMode: z.enum(['equal', 'custom']).default('equal'),
  // Modo equal: seats deudores (sin el pagador).
  seatIds: z.array(z.string().min(1)).default([]),
  // Modo custom: reparto libre en JSON [{seatId, amount}].
  splitsJson: z.string().optional(),
})

type ExpensePart = { seatId: string; amount: number }

/**
 * Gasto grupal (pago único, sin MSI).
 * - Si pago YO: nace el movimiento directo con mi cuenta.
 * - Si pagó OTRO integrante: se guarda un reclamo pendiente; cuando ese
 *   usuario entra lo confirma eligiendo de qué cuenta suya salió (ahí nace
 *   el movimiento). Sin confirmar no mueve saldos.
 */
export async function createGroupExpense(formData: FormData) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const seatIds = formData.getAll('seatIds').map(String).filter(Boolean)
  const parsed = GroupExpenseSchema.safeParse({
    householdId: String(formData.get('householdId') ?? ''),
    payerSeatId: String(formData.get('payerSeatId') ?? ''),
    accountId: String(formData.get('accountId') ?? '') || undefined,
    amount: Number(formData.get('amount')),
    concept: String(formData.get('concept') ?? ''),
    category: String(formData.get('category') ?? 'OTRO'),
    date: String(formData.get('date') ?? ''),
    splitMode: String(formData.get('splitMode') ?? 'equal'),
    seatIds,
    splitsJson: String(formData.get('splitsJson') ?? '') || undefined,
  })
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data

  const catError = await checkCategory(userId, v.category, 'EXPENSE')
  if (catError) return { error: catError }

  const membership = await prisma.householdMember.findFirst({
    where: { householdId: v.householdId, userId },
    select: { id: true },
  })
  if (!membership) return { error: 'No eres parte de este grupo' }
  const group = await getGroupHousehold(v.householdId)
  if ('error' in group) return { error: group.error }
  if (group.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }

  const payerSeat = await prisma.householdMember.findFirst({
    where: { householdId: v.householdId, id: v.payerSeatId },
    select: { id: true, userId: true, displayName: true },
  })
  if (!payerSeat) return { error: 'Quien pagó ya no está en el grupo' }
  const payerIsMe = payerSeat.userId === userId

  // Reparto: partes iguales o importes libres.
  // seatIds = participantes marcados (puede incluir al pagador si consume).
  // - equal: se divide entre los marcados; cada deudor recibe su parte y
  //   los centavos sueltos van a los primeros deudores.
  // - custom: importes de los deudores; si el pagador no está marcado, deben
  //   sumar el total; si sí, la diferencia es su parte consumida.
  const totalC = toCents(v.amount)
  const payerInSplit = seatIds.includes(payerSeat.id)
  const debtorIds = seatIds.filter((id) => id !== payerSeat.id)
  if (debtorIds.length === 0)
    return { error: 'Elige quiénes participan en el reparto' }
  // En importes, el pagador también pone su parte: las entries cubren a
  // TODOS los marcados y deben sumar el total exacto.
  let parts: ExpensePart[] = []
  if (v.splitMode === 'custom') {
    let raw: unknown = null
    try {
      raw = JSON.parse(v.splitsJson ?? 'null')
    } catch {
      raw = null
    }
    if (!Array.isArray(raw) || raw.length === 0)
      return { error: 'Reparte el monto entre integrantes' }
    const seen = new Set<string>()
    let sumC = 0
    for (const r of raw) {
      const seatId = typeof r?.seatId === 'string' ? r.seatId : ''
      const amount = typeof r?.amount === 'number' ? r.amount : NaN
      if (!seatId || !(amount > 0) || seen.has(seatId))
        return { error: 'Reparto inválido' }
      seen.add(seatId)
      sumC += toCents(amount)
      parts.push({ seatId, amount: fromCents(toCents(amount)) })
    }
    if (sumC !== totalC)
      return { error: 'El reparto debe sumar el total del gasto' }
    if (
      parts.length !== seatIds.length ||
      !parts.every((p) => seatIds.includes(p.seatId))
    )
      return { error: 'El reparto no coincide con los participantes' }
    // Sin la parte del pagador en las deudas: los shares son solo deudores
    // (la parte del pagador se deriva como total − deudores).
  } else {
    const divisor = debtorIds.length + (payerInSplit ? 1 : 0)
    const perC = Math.floor(totalC / divisor)
    let restC = totalC - perC * divisor
    parts = debtorIds.map((seatId) => {
      const extra = restC > 0 ? 1 : 0
      restC -= extra
      return { seatId, amount: fromCents(perC + extra) }
    })
  }
  const debtorParts = parts.filter((p) => p.seatId !== payerSeat.id)
  if (debtorParts.length === 0)
    return { error: 'Elige quiénes participan en el reparto' }

  const seats = await prisma.householdMember.findMany({
    where: {
      householdId: v.householdId,
      id: { in: debtorParts.map((p) => p.seatId) },
    },
    select: { id: true, userId: true },
  })
  if (seats.length !== debtorParts.length)
    return { error: 'Algún integrante ya no está en el grupo' }

  // Yo pagué: movimiento directo con mi cuenta.
  if (payerIsMe) {
    if (!v.accountId) return { error: 'Elige de qué cuenta salió' }
    const account = await prisma.account.findFirst({
      where: { id: v.accountId, userId },
    })
    if (!account) return { error: 'Cuenta no encontrada' }

    await prisma.$transaction(async (db) => {
      const tx = await db.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: v.amount,
          concept: v.concept.trim(),
          category: v.category,
          date: parseWallInput(v.date),
          accountId: v.accountId as string,
          createdById: userId,
          installments: 1,
          isShared: true,
          householdId: v.householdId,
        },
      })
      for (const part of debtorParts) {
        const seat = seats.find((s) => s.id === part.seatId)!
        await db.transactionShare.create({
          data: {
            transactionId: tx.id,
            debtorId: seat.userId,
            seatId: seat.id,
            sharePct: (toCents(part.amount) / totalC) * 100,
            monthlyAmount: part.amount,
            isFixedAmount: v.splitMode === 'custom',
          },
        })
      }
    })
    revalidateAll()
    return { ok: true as const }
  }

  // Pagó otro: reclamo pendiente hasta que confirme con su cuenta.
  await prisma.groupExpenseClaim.create({
    data: {
      householdId: v.householdId,
      concept: v.concept.trim(),
      amount: v.amount,
      category: v.category,
      date: parseWallInput(v.date),
      payerSeatId: payerSeat.id,
      registeredById: userId,
      splits: parts.map((p) => ({ seatId: p.seatId, amount: p.amount })),
      payerInSplit,
    },
  })
  revalidateAll()
  return { ok: true as const, pending: true as const }
}

/**
 * El pagador confirma un reclamo: elige de qué cuenta suya salió y nace el
 * movimiento real con su reparto. Solo el ocupante del seat pagador.
 */
export async function confirmGroupExpenseClaim(
  claimId: string,
  accountId: string,
) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const claim = await prisma.groupExpenseClaim.findUnique({
    where: { id: claimId },
    include: {
      household: { select: { kind: true, status: true } },
      payerSeat: { select: { id: true, userId: true, householdId: true } },
    },
  })
  if (!claim || claim.household.kind !== 'GROUP')
    return { error: 'Reclamo no encontrado' }
  if (claim.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }
  if (claim.payerSeat.userId !== userId)
    return { error: 'Solo quien pagó confirma desde qué cuenta fue' }

  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  })
  if (!account) return { error: 'Cuenta no encontrada' }
  const catError = await checkCategory(userId, claim.category, 'EXPENSE')
  if (catError) return { error: catError }

  const rawSplits = (Array.isArray(claim.splits) ? claim.splits : []) as {
    seatId?: unknown
    amount?: unknown
  }[]
  const parts: ExpensePart[] = []
  const seen = new Set<string>()
  for (const r of rawSplits) {
    const seatId = typeof r.seatId === 'string' ? r.seatId : ''
    const amount = typeof r.amount === 'number' ? r.amount : NaN
    if (!seatId || !(amount > 0) || seen.has(seatId))
      return { error: 'El reparto guardado es inválido' }
    seen.add(seatId)
    parts.push({ seatId, amount: fromCents(toCents(amount)) })
  }
  if (parts.length === 0) return { error: 'El reparto guardado es inválido' }
  // Reclamos nuevos: las entries cubren a todos y suman el total.
  // Reclamos viejos: solo deudores y la diferencia era del pagador.
  const storedSumC = parts.reduce((a, p) => a + toCents(p.amount), 0)
  const totalClaimC = toCents(Number(claim.amount))
  if (storedSumC > totalClaimC)
    return { error: 'El reparto guardado es inválido' }
  if (!claim.payerInSplit && storedSumC !== totalClaimC)
    return { error: 'El reparto guardado es inválido' }
  // Reclamos nuevos traen la parte del pagador: no genera deuda.
  const debtorParts = parts.filter((p) => p.seatId !== claim.payerSeatId)
  if (debtorParts.length === 0)
    return { error: 'El reparto guardado es inválido' }

  const seats = await prisma.householdMember.findMany({
    where: {
      householdId: claim.householdId,
      id: { in: debtorParts.map((p) => p.seatId) },
    },
    select: { id: true, userId: true },
  })
  if (seats.length !== debtorParts.length)
    return { error: 'Algún integrante ya no está en el grupo' }

  const totalC = toCents(Number(claim.amount))
  await prisma.$transaction(async (db) => {
    const tx = await db.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: claim.amount,
        concept: claim.concept,
        category: claim.category,
        date: claim.date,
        accountId: account.id,
        createdById: userId,
        installments: 1,
        isShared: true,
        householdId: claim.householdId,
      },
    })
    for (const part of debtorParts) {
      const seat = seats.find((s) => s.id === part.seatId)!
      await db.transactionShare.create({
        data: {
          transactionId: tx.id,
          debtorId: seat.userId,
          seatId: seat.id,
          sharePct: (toCents(part.amount) / totalC) * 100,
          monthlyAmount: part.amount,
          isFixedAmount: true,
        },
      })
    }
    await db.groupExpenseClaim.delete({ where: { id: claim.id } })
  })
  revalidateAll()
  return { ok: true as const }
}

/** Cancelar un reclamo pendiente (quien lo registró o el creador). */
export async function cancelGroupExpenseClaim(claimId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const claim = await prisma.groupExpenseClaim.findUnique({
    where: { id: claimId },
    include: {
      household: { select: { kind: true, createdById: true } },
    },
  })
  if (!claim || claim.household.kind !== 'GROUP')
    return { error: 'Reclamo no encontrado' }
  if (claim.registeredById !== userId && claim.household.createdById !== userId)
    return { error: 'Solo quien lo registró puede cancelarlo' }

  await prisma.groupExpenseClaim.delete({ where: { id: claim.id } })
  revalidateAll()
  return { ok: true as const }
}

export type GroupDetail = {
  id: string
  name: string
  code: string | null
  /** CLOSED = liquidado: no acepta movimientos ni integrantes. */
  status: 'ACTIVE' | 'CLOSED'
  isCreator: boolean
  isMember: boolean
  members: {
    id: string
    displayName: string
    occupied: boolean
    isMe: boolean
    occupantName: string | null
    paid: number
    owed: number
    balance: number
  }[]
  expenses: {
    id: string
    concept: string
    amount: number
    date: string
    /** Mes de la parcialidad (pago único): clave de registro del abono. */
    payKey: string
    creatorName: string
    isMine: boolean
    accountName: string | null
    /** Lo consumido por quien pagó (total − partes de deudores). */
    payerPortion: number
    shares: {
      id: string
      seatName: string
      debtorName: string | null
      monthly: number
      paid: number
      pending: number
      isMine: boolean
    }[]
  }[]
  pending: {
    toConfirm: {
      id: string
      amount: number
      month: string
      monthLabel: string
      concept: string
      monthly: number
      shareId: string
      registeredByName: string
    }[]
    myPending: {
      id: string
      amount: number
      month: string
      monthLabel: string
      concept: string
      shareId: string
    }[]
  }
  /** Liquidaciones neteadas pendientes (las registran/confirman miembros). */
  settlements: {
    toConfirm: SettlementRow[]
    myPending: SettlementRow[]
  }
  /** Gastos que alguien dice que otro pagó: esperan su confirmación. */
  claims: {
    id: string
    concept: string
    amount: number
    date: string
    category: string
    payerSeatId: string
    payerName: string
    registeredByName: string
    /** Yo soy quien supuestamente pagó: elijo la cuenta para confirmar. */
    isPayerMe: boolean
    canCancel: boolean
    /** Parte explícita de quien pagó (0 si no consume). */
    payerAmount: number
    splits: {
      seatId: string
      seatName: string
      amount: number
    }[]
  }[]
}

/** Detalle del grupo: miembros, gastos y saldos (solo miembros). */
export async function getGroupDetail(
  householdId: string,
): Promise<{ error: string } | (GroupDetail & { ok: true })> {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const h = await prisma.household.findUnique({
    where: { id: householdId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })
  if (!h || h.kind !== 'GROUP') return { error: 'Grupo no encontrado' }
  const isMember = h.members.some((m) => m.userId === userId)
  if (!isMember) return { error: 'No eres parte de este grupo' }

  const txs = await prisma.transaction.findMany({
    where: { householdId, type: 'EXPENSE' },
    include: {
      createdBy: { select: { id: true, name: true } },
      account: { select: { name: true, statementDay: true, dueDay: true } },
      shares: {
        include: {
          debtor: { select: { id: true, name: true } },
          seat: { select: { id: true, displayName: true, userId: true } },
        },
      },
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  const shareIds = txs.flatMap((t) => t.shares.map((s) => s.id))
  const sums = await getLineSums(shareIds)
  const monthLabelOf = (m: string) => {
    const [y, mo] = m.split('-').map(Number)
    return monthLabelEs(new Date(y, mo - 1, 1))
  }

  // Pagos pendientes del grupo: los que me deben confirmar + los míos en espera.
  const pendingRows =
    shareIds.length > 0
      ? await prisma.debtPayment.findMany({
          where: { shareId: { in: shareIds }, status: 'PENDING' },
          include: {
            share: {
              include: {
                transaction: { include: { createdBy: true } },
              },
            },
            registeredBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : []
  const toConfirm = pendingRows
    .filter(
      (p) =>
        p.registeredById !== userId &&
        p.share.transaction.createdById === userId,
    )
    .map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      month: p.month,
      monthLabel: monthLabelOf(p.month),
      concept: p.share.transaction.concept,
      monthly: Number(p.share.monthlyAmount),
      shareId: p.shareId,
      registeredByName: p.registeredBy.name,
    }))
  const myPending = pendingRows
    .filter((p) => p.registeredById === userId)
    .map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      month: p.month,
      monthLabel: monthLabelOf(p.month),
      concept: p.share.transaction.concept,
      shareId: p.shareId,
    }))

  const paidByMember = new Map<string, number>()
  const owedBySeat = new Map<string, number>()
  const expenses: GroupDetail['expenses'] = txs.map((t) => {
    const payerSeat = h.members.find((m) => m.userId === t.createdById)
    const txTotalC = toCents(Number(t.amount))
    if (payerSeat) {
      paidByMember.set(
        payerSeat.id,
        (paidByMember.get(payerSeat.id) ?? 0) + Number(t.amount),
      )
    }
    // Lo consumido por quien pagó = total − partes de los deudores.
    // (En gastos viejos puede ser 0: antes se dividía solo entre deudores.)
    const debtorSumC = t.shares.reduce(
      (a, s) => a + toCents(Number(s.monthlyAmount)),
      0,
    )
    const payerPortionC = Math.max(0, txTotalC - debtorSumC)
    if (payerSeat && payerPortionC > 0) {
      owedBySeat.set(
        payerSeat.id,
        (owedBySeat.get(payerSeat.id) ?? 0) + fromCents(payerPortionC),
      )
    }
    // Pago único: la parcialidad cae en el mes de compra (o de vencimiento
    // si la cuenta es crédito con corte), igual que en pareja.
    const payKey =
      payableInstallments(
        new Date(t.date),
        1,
        t.account?.statementDay ?? null,
        t.account?.dueDay ?? null,
      )[0]?.payKey ?? t.date.toISOString().slice(0, 7)
    return {
      id: t.id,
      concept: t.concept,
      amount: Number(t.amount),
      date: t.date.toISOString(),
      payKey,
      creatorName: t.createdBy.name,
      isMine: t.createdById === userId,
      accountName: t.account?.name ?? null,
      payerPortion: fromCents(payerPortionC),
      shares: t.shares.map((s) => {
        const sum = sums.get(`${s.id}:${payKey}`) ?? {
          confirmed: 0,
          pending: 0,
        }
        if (s.seatId) {
          owedBySeat.set(
            s.seatId,
            (owedBySeat.get(s.seatId) ?? 0) + Number(s.monthlyAmount),
          )
        }
        const seatName = s.seat?.displayName ?? s.debtor?.name ?? 'Lugar'
        return {
          id: s.id,
          seatName,
          debtorName: s.debtor?.name ?? null,
          monthly: Number(s.monthlyAmount),
          paid: sum.confirmed,
          pending: sum.pending,
          isMine: (s.debtor?.id ?? s.seat?.userId) === userId,
        }
      }),
    }
  })

  const claimRows = await prisma.groupExpenseClaim.findMany({
    where: { householdId },
    include: {
      payerSeat: {
        select: { id: true, displayName: true, userId: true },
      },
      registeredBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const memberById = new Map(h.members.map((m) => [m.id, m]))
  const claims: GroupDetail['claims'] = claimRows.map((c) => {
    const rawSplits = (Array.isArray(c.splits) ? c.splits : []) as {
      seatId?: unknown
      amount?: unknown
    }[]
    const seat = c.payerSeat
    return {
      id: c.id,
      concept: c.concept,
      amount: Number(c.amount),
      date: c.date.toISOString(),
      category: c.category,
      payerSeatId: c.payerSeatId,
      payerName: seat.displayName,
      registeredByName: c.registeredBy.name,
      isPayerMe: seat.userId === userId,
      canCancel: c.registeredById === userId || h.createdById === userId,
      splits: rawSplits
        .filter(
          (r): r is { seatId: string; amount: number } =>
            typeof r.seatId === 'string' &&
            typeof r.amount === 'number' &&
            r.seatId !== c.payerSeatId,
        )
        .map((r) => ({
          seatId: r.seatId,
          seatName: memberById.get(r.seatId)?.displayName ?? 'Integrante',
          amount: r.amount,
        })),
      payerAmount: rawSplits
        .filter(
          (r): r is { seatId: string; amount: number } =>
            typeof r.seatId === 'string' &&
            typeof r.amount === 'number' &&
            r.seatId === c.payerSeatId,
        )
        .reduce((a, r) => a + r.amount, 0),
    }
  })

  // Balance NETO por seat (pagado − consumido ± liquidaciones confirmadas).
  const nets = await getGroupNets(householdId)
  const settlements = await getGroupSettlementPendings(householdId, userId)
  return {
    ok: true,
    id: h.id,
    name: h.name ?? 'Grupo',
    code: h.code,
    status: h.status,
    isCreator: h.createdById === userId,
    isMember,
    members: h.members.map((m) => {
      const paid = paidByMember.get(m.id) ?? 0
      const owed = owedBySeat.get(m.id) ?? 0
      return {
        id: m.id,
        displayName: m.displayName,
        occupied: m.userId != null,
        isMe: m.userId === userId,
        occupantName: m.user?.name ?? null,
        paid,
        owed,
        balance: (nets.get(m.id)?.netCents ?? 0) / 100,
      }
    }),
    expenses,
    pending: { toConfirm, myPending },
    claims,
    settlements,
  }
}

export type GroupSummary = {
  id: string
  code: string | null
  name: string
  status: 'ACTIVE' | 'CLOSED'
  isCreator: boolean
  memberCount: number
  memberNames: string[]
  /** Lo que YO debo en este grupo (restante por pagar). */
  myOwe: number
  /** Lo que ME deben en este grupo (restante por cobrar). */
  myOwed: number
  expenseCount: number
}

/** Resúmenes de mis grupos para la tab Compartidos (tarjetas). */
export async function getGroupSummaries(
  userId: string,
): Promise<GroupSummary[]> {
  if (!process.env.DATABASE_URL) return []
  const memberships = await prisma.householdMember.findMany({
    where: { userId, household: { kind: 'GROUP' } },
    select: { householdId: true },
  })
  if (memberships.length === 0) return []
  const ids = memberships.map((m) => m.householdId)
  const households = await prisma.household.findMany({
    where: { id: { in: ids }, kind: 'GROUP' },
    include: {
      members: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  })
  return Promise.all(
    households.map(async (h) => {
      const mySeat = h.members.find((m) => m.userId === userId)
      const nets = await getGroupNets(h.id)
      const myNet = mySeat ? (nets.get(mySeat.id)?.netCents ?? 0) : 0
      const expenseCount = await prisma.transaction.count({
        where: { householdId: h.id, type: 'EXPENSE' },
      })
      return {
        id: h.id,
        code: h.code,
        name: h.name ?? 'Grupo',
        status: h.status,
        isCreator: h.createdById === userId,
        memberCount: h.members.length,
        memberNames: h.members.map((m) => m.displayName),
        myOwe: myNet < 0 ? -myNet / 100 : 0,
        myOwed: myNet > 0 ? myNet / 100 : 0,
        expenseCount,
      }
    }),
  )
}

/**
 * Cerrar grupo (solo el creador): requiere que todos estén a mano
 * (restante cero en cada parte). Congela movimientos e integrantes.
 */
export async function closeGroup(householdId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const group = await getGroupHousehold(householdId)
  if ('error' in group) return { error: group.error }
  if (group.household.createdById !== userId)
    return { error: 'Solo el creador cierra el grupo' }
  if (group.household.status === 'CLOSED') return { ok: true as const }

  const rest = await groupOutstanding(householdId)
  if (rest > 0)
    return { error: 'Aún hay saldos por liquidar para cerrar el grupo' }

  await prisma.household.update({
    where: { id: householdId },
    data: { status: 'CLOSED' },
  })
  revalidateAll()
  return { ok: true as const }
}

/** Reabrir un grupo cerrado (solo el creador). */
export async function reopenGroup(householdId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const group = await getGroupHousehold(householdId)
  if ('error' in group) return { error: group.error }
  if (group.household.createdById !== userId)
    return { error: 'Solo el creador reabre el grupo' }
  if (group.household.status === 'ACTIVE') return { ok: true as const }

  await prisma.household.update({
    where: { id: householdId },
    data: { status: 'ACTIVE' },
  })
  revalidateAll()
  return { ok: true as const }
}

/**
 * Eliminar grupo (solo el creador, solo liquidado): borra el contenedor y
 * sus deudas, pero conserva tus movimientos de dinero como personales
 * (isShared=false) para no romper tus saldos e historial.
 */
export async function deleteGroup(householdId: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const group = await getGroupHousehold(householdId)
  if ('error' in group) return { error: group.error }
  if (group.household.createdById !== userId)
    return { error: 'Solo el creador elimina el grupo' }

  const rest = await groupOutstanding(householdId)
  if (rest > 0)
    return { error: 'Liquida los saldos antes de eliminar el grupo' }

  const txs = await prisma.transaction.findMany({
    where: { householdId },
    select: { id: true },
  })
  const txIds = txs.map((t) => t.id)
  const shares = txIds.length
    ? await prisma.transactionShare.findMany({
        where: { transactionId: { in: txIds } },
        select: { id: true },
      })
    : []
  const shareIds = shares.map((s) => s.id)

  await prisma.$transaction(async (db) => {
    // Los pagos ligados se borran; sus movimientos de dinero quedan como
    // movimientos personales normales (ya eran tuyos).
    if (shareIds.length > 0) {
      await db.debtPayment.deleteMany({
        where: { shareId: { in: shareIds } },
      })
      await db.transactionShare.deleteMany({
        where: { id: { in: shareIds } },
      })
    }
    if (txIds.length > 0) {
      await db.transaction.updateMany({
        where: { id: { in: txIds } },
        data: { householdId: null, isShared: false },
      })
    }
    await db.householdMember.deleteMany({ where: { householdId } })
    await db.household.delete({ where: { id: householdId } })
  })
  revalidateAll()
  return { ok: true as const }
}

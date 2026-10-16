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
  // Meses sin intereses: 1 = contado. Igual que en movimientos personales.
  installments: z.coerce.number().min(1).max(24).default(1),
})

type ExpensePart = { seatId: string; total: number; monthly: number }

type ResolvedExpenseParts = {
  payerSeat: { id: string; userId: string | null; displayName: string }
  debtorParts: ExpensePart[]
  seats: { id: string; userId: string | null }[]
  totalC: number
}

/**
 * Valida pagador + reparto de un gasto grupal (igual o por importes) y
 * devuelve las partes deudoras listas para guardar. Compartido por crear
 * y editar para no duplicar la lógica.
 * `monthlyAmount` es la cuota MENSUAL por deudor (parte total / meses),
 * igual que en movimientos personales; `sharePct` sigue siendo % del total.
 */
async function resolveGroupExpenseParts(input: {
  householdId: string
  payerSeatId: string
  splitMode: 'equal' | 'custom'
  seatIds: string[]
  splitsJson?: string
  amount: number
  installments: number
}): Promise<{ error: string } | ResolvedExpenseParts> {
  const payerSeat = await prisma.householdMember.findFirst({
    where: { householdId: input.householdId, id: input.payerSeatId },
    select: { id: true, userId: true, displayName: true },
  })
  if (!payerSeat) return { error: 'Quien pagó ya no está en el grupo' }

  // seatIds = participantes marcados (puede incluir al pagador si consume).
  // - equal: se divide entre los marcados; cada deudor recibe su parte y
  //   los centavos sueltos van a los primeros deudores.
  // - custom: importes de TODOS los marcados (incluido el pagador) y deben
  //   sumar el total exacto.
  const totalC = toCents(input.amount)
  const payerInSplit = input.seatIds.includes(payerSeat.id)
  const debtorIds = input.seatIds.filter((id) => id !== payerSeat.id)
  if (debtorIds.length === 0)
    return { error: 'Elige quiénes participan en el reparto' }
  let parts: ExpensePart[] = []
  if (input.splitMode === 'custom') {
    let raw: unknown = null
    try {
      raw = JSON.parse(input.splitsJson ?? 'null')
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
      parts.push({ seatId, total: fromCents(toCents(amount)), monthly: 0 })
    }
    if (sumC !== totalC)
      return { error: 'El reparto debe sumar el total del gasto' }
    if (
      parts.length !== input.seatIds.length ||
      !parts.every((p) => input.seatIds.includes(p.seatId))
    )
      return { error: 'El reparto no coincide con los participantes' }
    // Sin la parte del pagador en las deudas: los shares son solo deudores
    // (la parte del pagador se deriva como total − deudores).
    // La mensualidad de cada share es su parte total / meses (redondeo por
    // share; la diferencia de centavos la absorbe la parte del pagador).
  } else {
    const divisor = debtorIds.length + (payerInSplit ? 1 : 0)
    const perC = Math.floor(totalC / divisor)
    let restC = totalC - perC * divisor
    parts = debtorIds.map((seatId) => {
      const extra = restC > 0 ? 1 : 0
      restC -= extra
      return { seatId, total: fromCents(perC + extra), monthly: 0 }
    })
  }
  const n = Math.max(1, Math.round(input.installments))
  const debtorParts = parts
    .filter((p) => p.seatId !== payerSeat.id)
    .map((p) => ({
      seatId: p.seatId,
      total: p.total,
      monthly: fromCents(Math.round(toCents(p.total) / n)),
    }))
  if (debtorParts.length === 0)
    return { error: 'Elige quiénes participan en el reparto' }

  const seats = await prisma.householdMember.findMany({
    where: {
      householdId: input.householdId,
      id: { in: debtorParts.map((p) => p.seatId) },
    },
    select: { id: true, userId: true },
  })
  if (seats.length !== debtorParts.length)
    return { error: 'Algún integrante ya no está en el grupo' }

  return { payerSeat, debtorParts, seats, totalC }
}

/**
 * Gasto grupal: se registra SIEMPRE de inmediato (a 1 mes o a MSI).
 * - Si pago YO: el movimiento nace con mi cuenta.
 * - Si pagó OTRO integrante (reclamado o no): el movimiento nace sin cuenta
 *   (no mueve saldos personales); el pagador la indica después desde el
 *   detalle del grupo y ahí se crea su movimiento personal vinculado.
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
    installments: Number(formData.get('installments') ?? 1),
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

  const n = Math.max(1, Math.round(v.installments))

  const resolved = await resolveGroupExpenseParts({
    householdId: v.householdId,
    payerSeatId: v.payerSeatId,
    splitMode: v.splitMode,
    seatIds,
    splitsJson: v.splitsJson,
    amount: v.amount,
    installments: n,
  })
  if ('error' in resolved) return { error: resolved.error }
  const { payerSeat, debtorParts, seats, totalC } = resolved
  const payerIsMe = payerSeat.userId === userId

  // Solo puedo atar MI cuenta al movimiento (es mi dinero).
  // Si pago yo, la cuenta es obligatoria; si pagó otro, nace sin cuenta y
  // el pagador la indica después desde el detalle del grupo.
  let accountId: string | null = null
  if (payerIsMe) {
    if (!v.accountId) return { error: 'Elige de qué cuenta salió' }
    const account = await prisma.account.findFirst({
      where: { id: v.accountId, userId },
      select: { id: true },
    })
    if (!account) return { error: 'Cuenta no encontrada' }
    accountId = account.id
  }

  await prisma.$transaction(async (db) => {
    const tx = await db.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: v.amount,
        concept: v.concept.trim(),
        category: v.category,
        date: parseWallInput(v.date),
        accountId,
        createdById: userId,
        installments: n,
        isShared: true,
        householdId: v.householdId,
        paidBySeatId: payerSeat.id,
      },
    })
    for (const part of debtorParts) {
      const seat = seats.find((s) => s.id === part.seatId)!
      await db.transactionShare.create({
        data: {
          transactionId: tx.id,
          debtorId: seat.userId,
          seatId: seat.id,
          sharePct: (toCents(part.total) / totalC) * 100,
          monthlyAmount: part.monthly,
          isFixedAmount: v.splitMode === 'custom',
        },
      })
    }
  })
  revalidateAll()
  return { ok: true as const, pending: payerIsMe ? undefined : (true as const) }
}

const UpdateGroupExpenseSchema = GroupExpenseSchema.extend({
  id: z.string().min(1),
})

/**
 * Edita un gasto grupal con el mismo formulario de registro (concepto,
 * monto, categoría, fecha, pagador y reparto). Lo puede hacer quien lo
 * registró o quien pagó. La cuenta no se toca aquí: pertenece al
 * movimiento personal del pagador (se indica desde el detalle).
 * Si ya tiene pagos registrados, el reparto queda fijo.
 */
export async function updateGroupExpense(formData: FormData) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const seatIds = formData.getAll('seatIds').map(String).filter(Boolean)
  const parsed = UpdateGroupExpenseSchema.safeParse({
    id: String(formData.get('id') ?? ''),
    householdId: String(formData.get('householdId') ?? ''),
    payerSeatId: String(formData.get('payerSeatId') ?? ''),
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

  const tx = await prisma.transaction.findUnique({
    where: { id: v.id },
    include: {
      household: { select: { kind: true, status: true } },
      paidBySeat: { select: { id: true, userId: true } },
      shares: { select: { id: true } },
    },
  })
  if (!tx || !tx.householdId || tx.household?.kind !== 'GROUP')
    return { error: 'Gasto no encontrado' }
  if (tx.householdId !== v.householdId)
    return { error: 'El gasto no es de este grupo' }
  const isCreator = tx.createdById === userId
  const isPayer = (tx.paidBySeat?.userId ?? null) === userId
  if (!isCreator && !isPayer) return { error: 'Gasto no encontrado' }
  if (tx.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }

  // Con pagos registrados, el reparto queda fijo: solo cabecera.
  // Los meses tampoco cambian nunca al editar (igual que en movimientos
  // personales): las parcialidades ya registradas usan las claves de mes
  // originales y los shares se recrean por mes.
  const rawInstallments = formData.get('installments')
  if (
    rawInstallments != null &&
    String(rawInstallments) !== '' &&
    Math.max(1, Math.round(Number(rawInstallments))) !==
      Math.max(1, Math.round(tx.installments))
  ) {
    return { error: 'Los meses no se pueden cambiar al editar' }
  }
  const hasPayments =
    tx.shares.length > 0 &&
    (await prisma.debtPayment.count({
      where: { share: { transactionId: tx.id } },
    })) > 0

  const catError = await checkCategory(userId, v.category, 'EXPENSE')
  if (catError) return { error: catError }

  const header = {
    amount: v.amount,
    concept: v.concept.trim(),
    category: v.category,
    date: parseWallInput(v.date),
  }
  if (hasPayments) {
    await prisma.$transaction(async (db) => {
      await db.transaction.update({ where: { id: tx.id }, data: header })
      if (tx.payerTransactionId) {
        await db.transaction.updateMany({
          where: { id: tx.payerTransactionId },
          data: header,
        })
      }
    })
    revalidateAll()
    return { ok: true as const }
  }

  const resolved = await resolveGroupExpenseParts({
    householdId: v.householdId,
    payerSeatId: v.payerSeatId,
    splitMode: v.splitMode,
    seatIds,
    splitsJson: v.splitsJson,
    amount: v.amount,
    installments: tx.installments,
  })
  if ('error' in resolved) return { error: resolved.error }
  const { payerSeat, debtorParts, seats, totalC } = resolved

  const payerChanged = (tx.paidBySeatId ?? null) !== payerSeat.id

  await prisma.$transaction(async (db) => {
    if (tx.payerTransactionId) {
      if (payerChanged) {
        // El espejo era del pagador anterior: su premisa queda sin efecto.
        await db.transaction.deleteMany({
          where: { id: tx.payerTransactionId },
        })
      } else {
        await db.transaction.updateMany({
          where: { id: tx.payerTransactionId },
          data: header,
        })
      }
    }
    await db.transaction.update({
      where: { id: tx.id },
      data: {
        ...header,
        paidBySeatId: payerSeat.id,
        payerTransactionId: payerChanged ? null : tx.payerTransactionId,
      },
    })
    await db.transactionShare.deleteMany({
      where: { transactionId: tx.id },
    })
    for (const part of debtorParts) {
      const seat = seats.find((s) => s.id === part.seatId)!
      await db.transactionShare.create({
        data: {
          transactionId: tx.id,
          debtorId: seat.userId,
          seatId: seat.id,
          sharePct: (toCents(part.total) / totalC) * 100,
          monthlyAmount: part.monthly,
          isFixedAmount: v.splitMode === 'custom',
        },
      })
    }
  })
  revalidateAll()
  return { ok: true as const }
}

/**
 * El pagador indica de qué cuenta suya salió un gasto grupal que otro
 * registró a su nombre: se crea su movimiento personal (no compartido)
 * y se vincula al gasto del grupo. Solo el ocupante del seat pagador,
 * solo si el gasto aún no tiene cuenta indicada.
 */
export async function setGroupExpenseAccount(
  transactionId: string,
  accountId: string,
) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      household: { select: { kind: true, status: true, name: true } },
      paidBySeat: { select: { id: true, userId: true } },
    },
  })
  if (!tx || !tx.householdId || tx.household?.kind !== 'GROUP')
    return { error: 'Gasto no encontrado' }
  if (tx.household.status !== 'ACTIVE')
    return { error: 'Este grupo está cerrado' }
  if (tx.paidBySeat?.userId !== userId)
    return { error: 'Solo quien pagó indica desde qué cuenta fue' }
  if (tx.accountId != null || tx.payerTransactionId != null)
    return { error: 'Este gasto ya tiene cuenta indicada' }

  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  })
  if (!account) return { error: 'Cuenta no encontrada' }
  const catError = await checkCategory(userId, tx.category, 'EXPENSE')
  if (catError) return { error: catError }

  await prisma.$transaction(async (db) => {
    const personal = await db.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: tx.amount,
        concept: tx.concept,
        category: tx.category,
        date: tx.date,
        accountId: account.id,
        createdById: userId,
        installments: tx.installments,
        isShared: false,
      },
    })
    await db.transaction.update({
      where: { id: tx.id },
      data: { payerTransactionId: personal.id },
    })
  })
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
    category: string
    date: string
    /** Mes de la parcialidad (pago único): clave de registro del abono. */
    payKey: string
    /** Meses del gasto (1 = contado). */
    installments: number
    creatorName: string
    isMine: boolean
    /** Seat que pagó (null en datos viejos sin atribución). */
    payerSeatId: string | null
    /** Quién pagó (atribución por paidBySeat, no por quien registró). */
    payerName: string
    isPayerMe: boolean
    /** El gasto ya tiene cuenta indicada (personal del pagador). */
    hasAccount: boolean
    accountName: string | null
    /** Lo consumido por quien pagó (total − partes de deudores). */
    payerPortion: number
    shares: {
      id: string
      /** Seat deudor (null en datos viejos sin atribución). */
      seatId: string | null
      seatName: string
      debtorName: string | null
      /** Cuota mensual de este deudor (= parte total / meses). */
      monthly: number
      /** Meses con su abono confirmado/pendiente (uno por parcialidad). */
      months: { payKey: string; monthLabel: string; paid: number; pending: number }[]
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
  /** Gastos sin cuenta donde YO soy el pagador: debo indicar mi cuenta. */
  awaitingAccount: {
    id: string
    concept: string
    amount: number
    date: string
    registeredByName: string
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
      paidBySeat: { select: { id: true, displayName: true, userId: true } },
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
    const payerSeat =
      h.members.find((m) => m.id === t.paidBySeatId) ??
      h.members.find((m) => m.userId === t.createdById)
    const txTotalC = toCents(Number(t.amount))
    const n = Math.max(1, Math.round(t.installments))
    if (payerSeat) {
      paidByMember.set(
        payerSeat.id,
        (paidByMember.get(payerSeat.id) ?? 0) + Number(t.amount),
      )
    }
    // Lo consumido por quien pagó = total − partes de los deudores.
    // (En gastos viejos puede ser 0: antes se dividía solo entre deudores.)
    const debtorSumC = t.shares.reduce(
      (a, s) => a + toCents(Number(s.monthlyAmount)) * n,
      0,
    )
    const payerPortionC = Math.max(0, txTotalC - debtorSumC)
    if (payerSeat && payerPortionC > 0) {
      owedBySeat.set(
        payerSeat.id,
        (owedBySeat.get(payerSeat.id) ?? 0) + fromCents(payerPortionC),
      )
    }
    // Una fila por parcialidad (mes de compra o vencimiento si la cuenta
    // es crédito con corte), igual que en pareja.
    const payKeys = payableInstallments(
      new Date(t.date),
      t.installments,
      t.account?.statementDay ?? null,
      t.account?.dueDay ?? null,
    )
    const payKey = payKeys[0]?.payKey ?? t.date.toISOString().slice(0, 7)
    return {
      id: t.id,
      concept: t.concept,
      amount: Number(t.amount),
      category: t.category,
      date: t.date.toISOString(),
      payKey,
      installments: Math.max(1, Math.round(t.installments)),
      creatorName: t.createdBy.name,
      isMine: t.createdById === userId,
      payerSeatId: t.paidBySeatId,
      payerName: payerSeat?.displayName ?? t.createdBy.name,
      isPayerMe: payerSeat?.userId === userId,
      hasAccount: t.accountId != null,
      accountName: t.account?.name ?? null,
      payerPortion: fromCents(payerPortionC),
      shares: t.shares.map((s) => {
        const months = payKeys.map((p) => {
          const sum = sums.get(`${s.id}:${p.payKey}`) ?? {
            confirmed: 0,
            pending: 0,
          }
          return {
            payKey: p.payKey,
            monthLabel: monthLabelOf(p.payKey),
            paid: sum.confirmed,
            pending: sum.pending,
          }
        })
        const paid = months.reduce((a, m) => a + m.paid, 0)
        const pending = months.reduce((a, m) => a + m.pending, 0)
        if (s.seatId) {
          owedBySeat.set(
            s.seatId,
            (owedBySeat.get(s.seatId) ?? 0) +
              Number(s.monthlyAmount) * n,
          )
        }
        const seatName = s.seat?.displayName ?? s.debtor?.name ?? 'Lugar'
        return {
          id: s.id,
          seatId: s.seatId,
          seatName,
          debtorName: s.debtor?.name ?? null,
          monthly: Number(s.monthlyAmount),
          months,
          paid,
          pending,
          isMine: (s.debtor?.id ?? s.seat?.userId) === userId,
        }
      }),
    }
  })

  // Gastos sin cuenta donde YO soy el pagador: debo indicar de qué
  // cuenta mía salió (ahí nace mi movimiento personal vinculado).
  const awaitingAccount: GroupDetail['awaitingAccount'] = txs
    .filter(
      (t) =>
        t.accountId == null &&
        t.payerTransactionId == null &&
        (t.paidBySeat?.userId ?? null) === userId,
    )
    .map((t) => ({
      id: t.id,
      concept: t.concept,
      amount: Number(t.amount),
      date: t.date.toISOString(),
      registeredByName:
        t.createdById === userId ? 'Registrado por ti' : t.createdBy.name,
    }))

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
    awaitingAccount,
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
    // Las liquidaciones neteadas se borran; sus movimientos personales
    // (ingresos/egresos de cada quien) se conservan como historial.
    await db.groupSettlement.deleteMany({ where: { householdId } })
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

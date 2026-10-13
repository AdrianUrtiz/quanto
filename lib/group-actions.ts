'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { payableInstallments } from '@/lib/calculations'
import { checkCategory } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { newGroupCode, normalizeCode } from '@/lib/households'
import { fromCents, moneySchema, toCents } from '@/lib/money'
import { prisma } from '@/lib/prisma'
import { monthLabelEs } from '@/lib/utils'
import { parseWallInput } from '@/lib/walltime'

import { auth } from '@/auth'

function meIdOf(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null
}

function revalidateAll() {
  revalidatePath('/cuentas')
  revalidatePath('/actividad')
  revalidatePath('/resumen')
  revalidatePath('/grupos')
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
      household: { select: { kind: true } },
    },
  })
  if (!seat || seat.household.kind !== 'GROUP')
    return { error: 'Lugar no encontrado' }
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
    select: { id: true, kind: true },
  })
  if (!h || h.kind !== 'GROUP') return { error: 'No encontramos ese grupo' }
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

/** Añadir integrantes después de crear (solo el creador). Ej. "se me olvidó Axel". */
export async function addGroupSeats(householdId: string, formData: FormData) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  const h = await prisma.household.findUnique({
    where: { id: householdId },
    select: { id: true, kind: true, createdById: true },
  })
  if (!h || h.kind !== 'GROUP') return { error: 'Grupo no encontrado' }
  if (h.createdById !== userId)
    return { error: 'Solo el creador añade integrantes' }

  const names = dedupeNames(
    String(formData.get('seats') ?? '')
      .split(/[\n,]/)
      .map((s) => cleanName(s))
      .filter((s): s is string => s != null),
  )
  if (names.length === 0) return { error: 'Agrega al menos un nombre' }

  const existing = await prisma.householdMember.findMany({
    where: { householdId },
    select: { displayName: true },
  })
  const taken = new Set(existing.map((m) => m.displayName.toLowerCase()))
  const fresh = names.filter((n) => !taken.has(n.toLowerCase()))
  if (fresh.length === 0) return { error: 'Esos nombres ya están en el grupo' }

  await prisma.householdMember.createMany({
    data: fresh.map((displayName) => ({ householdId, displayName })),
  })
  revalidateAll()
  return { ok: true as const, added: fresh.length }
}

/** Renombrar un seat libre (solo el creador). */
export async function renameGroupSeat(memberId: string, rawName: string) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  const name = cleanName(rawName)
  if (!name) return { error: 'Nombre inválido' }

  const seat = await prisma.householdMember.findUnique({
    where: { id: memberId },
    include: { household: { select: { kind: true, createdById: true } } },
  })
  if (!seat || seat.household.kind !== 'GROUP')
    return { error: 'Lugar no encontrado' }
  if (seat.household.createdById !== userId)
    return { error: 'Solo el creador renombra lugares' }
  if (seat.userId) return { error: 'Ese lugar ya fue reclamado' }

  const clash = await prisma.householdMember.findFirst({
    where: {
      householdId: seat.householdId,
      displayName: name,
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

const GroupExpenseSchema = z.object({
  householdId: z.string().min(1),
  accountId: z.string().min(1, 'Elige una cuenta'),
  amount: moneySchema,
  concept: z.string().min(2, 'Agrega un concepto'),
  category: z.string().default('OTRO'),
  date: z.string(),
  // seatIds que participan en el reparto (sin contar al pagador).
  seatIds: z.array(z.string().min(1)).min(1, 'Elige quiénes participan'),
})

/**
 * Gasto grupal (pago único, sin MSI): lo paga un miembro con su cuenta y se
 * reparte en partes iguales entre los seats elegidos. Solo dentro del grupo.
 */
export async function createGroupExpense(formData: FormData) {
  const userId = meIdOf(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const seatIds = formData.getAll('seatIds').map(String).filter(Boolean)
  const parsed = GroupExpenseSchema.safeParse({
    householdId: String(formData.get('householdId') ?? ''),
    accountId: String(formData.get('accountId') ?? ''),
    amount: Number(formData.get('amount')),
    concept: String(formData.get('concept') ?? ''),
    category: String(formData.get('category') ?? 'OTRO'),
    date: String(formData.get('date') ?? ''),
    seatIds,
  })
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data

  const catError = await checkCategory(userId, v.category, 'EXPENSE')
  if (catError) return { error: catError }

  const account = await prisma.account.findFirst({
    where: { id: v.accountId, userId },
  })
  if (!account) return { error: 'Cuenta no encontrada' }

  const membership = await prisma.householdMember.findFirst({
    where: { householdId: v.householdId, userId },
    select: { id: true },
  })
  if (!membership) return { error: 'No eres parte de este grupo' }

  const seats = await prisma.householdMember.findMany({
    where: { householdId: v.householdId, id: { in: v.seatIds } },
    select: { id: true, userId: true, displayName: true },
  })
  if (seats.length !== v.seatIds.length)
    return { error: 'Algún integrante ya no está en el grupo' }
  if (seats.some((s) => s.userId === userId))
    return { error: 'No te incluyas: tú pagaste el total' }

  // Partes iguales entre los seats (centavos al primero para cuadrar).
  const totalC = toCents(v.amount)
  const perC = Math.floor(totalC / seats.length)
  let restC = totalC - perC * seats.length
  const amounts = seats.map(() => {
    const extra = restC > 0 ? 1 : 0
    restC -= extra
    return fromCents(perC + extra)
  })

  await prisma.$transaction(async (db) => {
    const tx = await db.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: v.amount,
        concept: v.concept.trim(),
        category: v.category,
        date: parseWallInput(v.date),
        accountId: v.accountId,
        createdById: userId,
        installments: 1,
        isShared: true,
        householdId: v.householdId,
      },
    })
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i]
      await db.transactionShare.create({
        data: {
          transactionId: tx.id,
          debtorId: seat.userId,
          seatId: seat.id,
          sharePct: (toCents(amounts[i]) / totalC) * 100,
          monthlyAmount: amounts[i],
          isFixedAmount: false,
        },
      })
    }
  })

  revalidateAll()
  return { ok: true as const }
}

export type GroupDetail = {
  id: string
  name: string
  code: string | null
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
    if (payerSeat) {
      paidByMember.set(
        payerSeat.id,
        (paidByMember.get(payerSeat.id) ?? 0) + Number(t.amount),
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

  return {
    ok: true,
    id: h.id,
    name: h.name ?? 'Grupo',
    code: h.code,
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
        balance: paid - owed,
      }
    }),
    expenses,
    pending: { toConfirm, myPending },
  }
}

export type GroupSummary = {
  id: string
  code: string | null
  name: string
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
      const txs = await prisma.transaction.findMany({
        where: { householdId: h.id, type: 'EXPENSE' },
        include: {
          account: { select: { statementDay: true, dueDay: true } },
          shares: true,
        },
      })
      const shareIds = txs.flatMap((t) => t.shares.map((s) => s.id))
      const sums = shareIds.length > 0 ? await getLineSums(shareIds) : new Map()
      let myOwe = 0
      let myOwed = 0
      for (const t of txs) {
        const payKey =
          payableInstallments(
            new Date(t.date),
            1,
            t.account?.statementDay ?? null,
            t.account?.dueDay ?? null,
          )[0]?.payKey ?? t.date.toISOString().slice(0, 7)
        for (const s of t.shares) {
          const sum = sums.get(`${s.id}:${payKey}`) ?? {
            confirmed: 0,
            pending: 0,
          }
          const rest = Math.max(0, Number(s.monthlyAmount) - sum.confirmed)
          if (rest <= 0) continue
          const debtorIsMe =
            s.debtorId === userId ||
            (s.debtorId == null &&
              h.members.some((m) => m.id === s.seatId && m.userId === userId))
          if (debtorIsMe) myOwe += rest
          else if (t.createdById === userId) myOwed += rest
        }
      }
      return {
        id: h.id,
        code: h.code,
        name: h.name ?? 'Grupo',
        isCreator: h.createdById === userId,
        memberCount: h.members.length,
        memberNames: h.members.map((m) => m.displayName),
        myOwe,
        myOwed,
        expenseCount: txs.length,
      }
    }),
  )
}

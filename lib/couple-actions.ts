'use server'

import { revalidatePath } from 'next/cache'

import { getOrCreatePairCode, normalizeCode } from '@/lib/households'
import { prisma } from '@/lib/prisma'

import { auth } from '@/auth'

function authedUserId(session: unknown): string | null {
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null
}

function revalidateAll() {
  revalidatePath('/ajustes')
  revalidatePath('/cuentas')
  revalidatePath('/actividad')
  revalidatePath('/resumen')
}

export type PairingState = {
  pairCode: string
  partner: { id: string; name: string } | null
  householdId: string | null
  sent: {
    id: string
    toName: string
    createdAt: string
    expiresAt: string
  }[]
  received: {
    id: string
    fromName: string
    createdAt: string
    expiresAt: string
  }[]
}

async function expireStale() {
  await prisma.coupleInvite.updateMany({
    where: { status: 'PENDING', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
}

export type PairingInviteRow = {
  id: string
  fromName: string
}

/** Solicitudes de vínculo pendientes para mí (serializable, sin montos). */
export async function getPairingInvites(
  userId: string,
): Promise<PairingInviteRow[]> {
  if (!process.env.DATABASE_URL) return []
  await expireStale()
  const rows = await prisma.coupleInvite.findMany({
    where: { toUserId: userId, status: 'PENDING' },
    include: { fromUser: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((r) => ({ id: r.id, fromName: r.fromUser.name }))
}

/** Estado de pareja para Ajustes: código, vínculo y solicitudes. */
export async function getPairingState(): Promise<
  { error: string } | (PairingState & { ok: true })
> {
  const userId = authedUserId(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  await expireStale()
  const pairCode = await getOrCreatePairCode(userId)

  const membership = await prisma.householdMember.findFirst({
    where: { userId, household: { kind: 'COUPLE' } },
    select: { householdId: true },
  })
  let partner: PairingState['partner'] = null
  let householdId: string | null = null
  if (membership) {
    householdId = membership.householdId
    const other = await prisma.householdMember.findFirst({
      where: { householdId, userId: { not: userId } },
      include: { user: { select: { id: true, name: true } } },
    })
    if (other?.user) partner = other.user
  }

  const [sent, received] = await Promise.all([
    prisma.coupleInvite.findMany({
      where: { fromUserId: userId, status: 'PENDING' },
      include: { toUser: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.coupleInvite.findMany({
      where: { toUserId: userId, status: 'PENDING' },
      include: { fromUser: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return {
    ok: true,
    pairCode,
    partner,
    householdId,
    sent: sent.map((s) => ({
      id: s.id,
      toName: s.toUser.name,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
    received: received.map((r) => ({
      id: r.id,
      fromName: r.fromUser.name,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    })),
  }
}

/** Solicitar vínculo pegando el código Q-XXXXXX de la otra persona. */
export async function requestPairing(rawCode: string) {
  const userId = authedUserId(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const code = normalizeCode(rawCode)
  if (!code || !code.startsWith('Q-'))
    return { error: 'Código inválido (Q-XXXXXX)' }

  await expireStale()
  const mine = await prisma.householdMember.findFirst({
    where: { userId, household: { kind: 'COUPLE' } },
    select: { householdId: true },
  })
  if (mine) return { error: 'Ya tienes pareja vinculada' }

  const target = await prisma.user.findUnique({
    where: { pairCode: code },
    select: { id: true, name: true },
  })
  if (!target) return { error: 'No encontramos ese código' }
  if (target.id === userId) return { error: 'Ese es tu propio código' }

  const targetLinked = await prisma.householdMember.findFirst({
    where: { userId: target.id, household: { kind: 'COUPLE' } },
    select: { householdId: true },
  })
  if (targetLinked) return { error: `${target.name} ya tiene pareja vinculada` }

  const existing = await prisma.coupleInvite.findFirst({
    where: {
      status: 'PENDING',
      OR: [
        { fromUserId: userId, toUserId: target.id },
        { fromUserId: target.id, toUserId: userId },
      ],
    },
    select: { id: true, fromUserId: true },
  })
  if (existing) {
    return {
      error:
        existing.fromUserId === userId
          ? 'Ya le enviaste solicitud, está pendiente'
          : 'Te llegó solicitud de esa persona: acéptala en Ajustes',
    }
  }

  await prisma.coupleInvite.create({
    data: {
      fromUserId: userId,
      toUserId: target.id,
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
    },
  })
  revalidateAll()
  return { ok: true, toName: target.name }
}

/** Aceptar solicitud: crea el Household COUPLE con ambos miembros. */
export async function acceptPairing(inviteId: string) {
  const userId = authedUserId(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const invite = await prisma.coupleInvite.findFirst({
    where: { id: inviteId, toUserId: userId, status: 'PENDING' },
    include: {
      fromUser: { select: { id: true, name: true } },
    },
  })
  if (!invite) return { error: 'Solicitud no encontrada' }
  if (invite.expiresAt < new Date()) {
    await prisma.coupleInvite.update({
      where: { id: invite.id },
      data: { status: 'EXPIRED' },
    })
    return { error: 'La solicitud expiró, pide una nueva' }
  }

  const [mine, theirs] = await Promise.all([
    prisma.householdMember.findFirst({
      where: { userId, household: { kind: 'COUPLE' } },
      select: { householdId: true },
    }),
    prisma.householdMember.findFirst({
      where: { userId: invite.fromUserId, household: { kind: 'COUPLE' } },
      select: { householdId: true },
    }),
  ])
  if (mine) return { error: 'Ya tienes pareja vinculada' }
  if (theirs)
    return { error: `${invite.fromUser.name} ya se vinculó con alguien` }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })

  await prisma.$transaction(async (db) => {
    const household = await db.household.create({
      data: {
        kind: 'COUPLE',
        createdById: userId,
      },
    })
    await db.householdMember.createMany({
      data: [
        {
          householdId: household.id,
          userId: invite.fromUserId,
          displayName: invite.fromUser.name,
        },
        {
          householdId: household.id,
          userId,
          displayName: me?.name ?? 'Yo',
        },
      ],
    })
    await db.coupleInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED' },
    })
    // Limpia otras pendientes cruzadas entre ambos.
    await db.coupleInvite.updateMany({
      where: {
        status: 'PENDING',
        OR: [
          { fromUserId: userId, toUserId: invite.fromUserId },
          { fromUserId: invite.fromUserId, toUserId: userId },
        ],
      },
      data: { status: 'REJECTED' },
    })
  })

  revalidateAll()
  return { ok: true }
}

export async function rejectPairing(inviteId: string) {
  const userId = authedUserId(await auth())
  if (!userId) return { error: 'No autenticado' }
  const invite = await prisma.coupleInvite.findFirst({
    where: { id: inviteId, toUserId: userId, status: 'PENDING' },
    select: { id: true },
  })
  if (!invite) return { error: 'Solicitud no encontrada' }
  await prisma.coupleInvite.update({
    where: { id: invite.id },
    data: { status: 'REJECTED' },
  })
  revalidateAll()
  return { ok: true }
}

export async function cancelPairing(inviteId: string) {
  const userId = authedUserId(await auth())
  if (!userId) return { error: 'No autenticado' }
  const invite = await prisma.coupleInvite.findFirst({
    where: { id: inviteId, fromUserId: userId, status: 'PENDING' },
    select: { id: true },
  })
  if (!invite) return { error: 'Solicitud no encontrada' }
  await prisma.coupleInvite.update({
    where: { id: invite.id },
    data: { status: 'REJECTED' },
  })
  revalidateAll()
  return { ok: true }
}

/** Desvincular: rompe el household, conserva movimientos y deudas. */
export async function unlinkCouple() {
  const userId = authedUserId(await auth())
  if (!userId) return { error: 'No autenticado' }
  if (!process.env.DATABASE_URL) return { error: 'Configura DATABASE_URL' }

  const membership = await prisma.householdMember.findFirst({
    where: { userId, household: { kind: 'COUPLE' } },
    select: { householdId: true },
  })
  if (!membership) return { error: 'No tienes pareja vinculada' }

  // Las transacciones de pareja tienen householdId null (legacy): el historial
  // queda intacto. Solo se borra el vínculo.
  await prisma.household.delete({ where: { id: membership.householdId } })
  revalidateAll()
  return { ok: true }
}

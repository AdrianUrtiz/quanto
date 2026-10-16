// Households: parejas (COUPLE, máx 2, con aceptación) y grupos (GROUP, seats).
// Sin imports de cliente: solo prisma + utilidades puras.
import { prisma } from '@/lib/prisma'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomSuffix(length = 6): string {
  let s = ''
  const n = ALPHABET.length
  for (let i = 0; i < length; i++) {
    s += ALPHABET[Math.floor(Math.random() * n)]
  }
  return s
}

/** Código personal de pareja: Q-XXXXXX. */
export function newPairCode(): string {
  return `Q-${randomSuffix()}`
}

/** Código reutilizable de grupo: G-XXXXXX. */
export function newGroupCode(): string {
  return `G-${randomSuffix()}`
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase().replace(/[\s-]/g, '')
  if (v.length < 7 || v.length > 8) return null
  const prefix = v[0]
  const body = v.slice(1)
  if (prefix !== 'Q' && prefix !== 'G') return null
  if (!/^[A-Z2-9]+$/.test(body)) return null
  return `${prefix}-${body}`
}

/** Mi household COUPLE (si tengo), con el otro miembro resuelto. */
export async function getCoupleOf(
  userId: string,
): Promise<{ householdId: string; partnerId: string } | null> {
  const membership = await prisma.householdMember.findFirst({
    where: {
      userId,
      household: { kind: 'COUPLE' },
    },
    select: { householdId: true },
  })
  if (!membership) return null
  const other = await prisma.householdMember.findFirst({
    where: { householdId: membership.householdId, userId: { not: userId } },
    select: { userId: true },
  })
  if (!other?.userId) return null
  return { householdId: membership.householdId, partnerId: other.userId }
}

/** Id de mi pareja o null (individual por defecto). */
export async function getPartnerId(userId: string): Promise<string | null> {
  const c = await getCoupleOf(userId)
  return c?.partnerId ?? null
}

/** Mi código personal Q-XXXXXX (lo genera la primera vez). */
export async function getOrCreatePairCode(userId: string): Promise<string> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { pairCode: true },
  })
  if (me?.pairCode) return me.pairCode
  for (let i = 0; i < 5; i++) {
    const code = newPairCode()
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { pairCode: code },
        select: { pairCode: true },
      })
      if (updated.pairCode) return updated.pairCode
    } catch (e) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        continue
      }
      throw e
    }
  }
  throw new Error('No se pudo generar tu código, intenta de nuevo')
}

/** Grupos donde soy miembro activo (con miembros y ocupación). */
export type MyGroup = {
  id: string
  code: string | null
  name: string
  createdById: string
  isCreator: boolean
  members: {
    id: string
    displayName: string
    occupied: boolean
    isMe: boolean
    occupantName: string | null
  }[]
}

export async function getMyGroups(userId: string): Promise<MyGroup[]> {
  const memberships = await prisma.householdMember.findMany({
    where: { userId, household: { kind: 'GROUP' } },
    select: { householdId: true },
  })
  if (memberships.length === 0) return []
  const ids = memberships.map((m) => m.householdId)
  const households = await prisma.household.findMany({
    where: { id: { in: ids }, kind: 'GROUP' },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return households.map((h) => ({
    id: h.id,
    code: h.code,
    name: h.name ?? 'Grupo',
    createdById: h.createdById,
    isCreator: h.createdById === userId,
    members: h.members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      occupied: m.userId != null,
      isMe: m.userId === userId,
      occupantName: m.user?.name ?? null,
    })),
  }))
}

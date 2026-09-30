'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  type BudgetPageData,
  MONTH_RE,
  getBudgetPageData,
  prevMonthKey,
} from '@/lib/budgets'
import { getCatalog } from '@/lib/catalog'
import { moneySchema } from '@/lib/money'
import { prisma } from '@/lib/prisma'

import { auth } from '@/auth'

const MonthSchema = z.string().regex(MONTH_RE, 'Mes inválido')

function authed() {
  return auth().then(
    (s) => (s?.user as { id?: string } | undefined)?.id ?? null,
  )
}

function noDb() {
  return !process.env.DATABASE_URL
}

/**
 * Datos del mes para el cliente (cambio de mes sin navegar).
 * Solo datos propios; las cuentas ajenas ni se consultan.
 */
export async function getBudgetMonth(
  month: string,
): Promise<{ ok: true; data: BudgetPageData } | { error: string }> {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (!MONTH_RE.test(month)) return { error: 'Mes inválido' }
  return { ok: true, data: await getBudgetPageData(userId, month) }
}

/** Busca o crea el presupuesto del mes (solo dueño). */
async function getOrCreateBudget(userId: string, month: string) {
  const found = await prisma.budget.findUnique({
    where: { userId_month: { userId, month } },
    select: { id: true },
  })
  if (found) return found
  return prisma.budget.create({
    data: { userId, month, baseIncome: 0 },
    select: { id: true },
  })
}

export async function setBaseIncome(formData: FormData) {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (noDb()) return { error: 'Configura DATABASE_URL' }

  const month = MonthSchema.safeParse(String(formData.get('month') ?? ''))
  if (!month.success) return { error: 'Mes inválido' }
  const income = z.coerce
    .number()
    .min(0, 'El ingreso no puede ser negativo')
    .safeParse(formData.get('baseIncome'))
  if (!income.success) return { error: 'Ingreso inválido' }

  const b = await getOrCreateBudget(userId, month.data)
  await prisma.budget.update({
    where: { id: b.id },
    data: { baseIncome: income.data },
  })
  revalidatePath('/presupuestos')
  return { ok: true }
}

const ItemSchema = z.object({
  month: z.string().regex(MONTH_RE, 'Mes inválido'),
  label: z.string().trim().min(2, 'Ponle un nombre'),
  amount: moneySchema,
  accountId: z.string().optional(),
})

export async function addBudgetItem(formData: FormData) {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (noDb()) return { error: 'Configura DATABASE_URL' }

  const parsed = ItemSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data

  // Si trae cuenta, debe ser propia y visible.
  if (v.accountId) {
    const acc = await prisma.account.findFirst({
      where: { id: v.accountId, userId, isActive: true },
      select: { id: true },
    })
    if (!acc) return { error: 'Cuenta no encontrada' }
  }

  const b = await getOrCreateBudget(userId, v.month)
  await prisma.budgetItem.create({
    data: {
      budgetId: b.id,
      label: v.label.trim().slice(0, 60),
      amount: v.amount,
      accountId: v.accountId || null,
    },
  })
  revalidatePath('/presupuestos')
  return { ok: true }
}

export async function deleteBudgetItem(id: string) {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (noDb()) return { error: 'Configura DATABASE_URL' }

  const item = await prisma.budgetItem.findFirst({
    where: { id, budget: { userId } },
    select: { id: true },
  })
  if (!item) return { error: 'No encontrado' }
  await prisma.budgetItem.delete({ where: { id } })
  revalidatePath('/presupuestos')
  return { ok: true }
}

const LimitSchema = z.object({
  month: z.string().regex(MONTH_RE, 'Mes inválido'),
  category: z.string().trim().min(1, 'Elige una categoría'),
  limit: moneySchema,
})

export async function setCategoryLimit(formData: FormData) {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (noDb()) return { error: 'Configura DATABASE_URL' }

  const parsed = LimitSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' }
  const v = parsed.data

  // La categoría debe existir en el catálogo (global o propia).
  const catalog = await getCatalog(userId)
  if (!catalog.some((c) => c.code === v.category))
    return { error: 'Categoría no válida' }

  const b = await getOrCreateBudget(userId, v.month)
  await prisma.budgetCategoryLimit.upsert({
    where: { budgetId_category: { budgetId: b.id, category: v.category } },
    create: { budgetId: b.id, category: v.category, limit: v.limit },
    update: { limit: v.limit },
  })
  revalidatePath('/presupuestos')
  return { ok: true }
}

export async function deleteCategoryLimit(month: string, category: string) {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (noDb()) return { error: 'Configura DATABASE_URL' }
  if (!MONTH_RE.test(month)) return { error: 'Mes inválido' }

  const b = await prisma.budget.findUnique({
    where: { userId_month: { userId, month } },
    select: { id: true },
  })
  if (!b) return { error: 'No encontrado' }
  await prisma.budgetCategoryLimit.deleteMany({
    where: { budgetId: b.id, category },
  })
  revalidatePath('/presupuestos')
  return { ok: true }
}

/** Copia base + fijos + límites del mes previo (solo si el destino está vacío). */
export async function copyPreviousMonth(month: string) {
  const userId = await authed()
  if (!userId) return { error: 'No autenticado' }
  if (noDb()) return { error: 'Configura DATABASE_URL' }
  if (!MONTH_RE.test(month)) return { error: 'Mes inválido' }

  const prev = await prisma.budget.findUnique({
    where: { userId_month: { userId, month: prevMonthKey(month) } },
    include: { items: true, limits: true },
  })
  if (!prev) return { error: 'No hay mes anterior que copiar' }
  const existing = await prisma.budget.findUnique({
    where: { userId_month: { userId, month } },
    select: { id: true },
  })
  if (existing) return { error: 'Este mes ya tiene presupuesto' }

  // Solo cuentas que sigo teniendo (las eliminadas pasan a general).
  const mine = await prisma.account.findMany({
    where: { userId, isActive: true },
    select: { id: true },
  })
  const mineIds = new Set(mine.map((a) => a.id))

  await prisma.budget.create({
    data: {
      userId,
      month,
      baseIncome: prev.baseIncome,
      items: {
        create: prev.items.map((i) => ({
          label: i.label,
          amount: i.amount,
          accountId:
            i.accountId && mineIds.has(i.accountId) ? i.accountId : null,
        })),
      },
      limits: {
        create: prev.limits.map((l) => ({
          category: l.category,
          limit: l.limit,
        })),
      },
    },
  })
  revalidatePath('/presupuestos')
  return { ok: true }
}

import { redirect } from 'next/navigation'

import { PresupuestosClient } from '@/components/presupuestos-client'

import { MONTH_RE, getBudgetPageData } from '@/lib/budgets'
import { getCatalog } from '@/lib/catalog'
import { prisma } from '@/lib/prisma'
import { monthKey, monthLabelEs } from '@/lib/utils'

import { auth } from '@/auth'

export const metadata = { title: 'Presupuestos' }
export const dynamic = 'force-dynamic'

const PAST = 6
const FUTURE = 6

export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams?: Promise<{ mes?: string }>
}) {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  if (!meId) redirect('/login')

  const now = new Date()
  const current = monthKey(now)
  const rawMes = (await searchParams)?.mes
  const initialMonth = rawMes && MONTH_RE.test(rawMes) ? rawMes : current

  // Selector: 6 pasados + actual + 6 futuros (los presupuestos son
  // planificación futura) + cualquiera con presupuesto guardado.
  const [data, budgets, accounts, catalog] = await Promise.all([
    getBudgetPageData(meId, initialMonth),
    prisma.budget.findMany({
      where: { userId: meId },
      select: { month: true },
    }),
    prisma.account.findMany({
      where: { userId: meId, isActive: true, isHidden: false },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    getCatalog(meId),
  ])

  const keys = new Set<string>([initialMonth, current])
  for (let i = PAST; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.add(monthKey(d))
  }
  for (let i = 1; i <= FUTURE; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    keys.add(monthKey(d))
  }
  for (const b of budgets) keys.add(b.month)
  const months = [...keys]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((k) => {
      const [y, m] = k.split('-').map(Number)
      return { key: k, label: monthLabelEs(new Date(y, m - 1, 1)) }
    })

  return (
    <PresupuestosClient
      initialMonth={initialMonth}
      initialData={data}
      months={months}
      cats={catalog.map((c) => ({
        code: c.code,
        name: c.name,
        iconName: c.iconName,
        color: c.color,
        kind: c.kind,
      }))}
      accountOpts={accounts}
    />
  )
}

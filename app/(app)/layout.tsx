import { redirect } from 'next/navigation'

import { BottomNav } from '@/components/bottom-nav'
import { Fab } from '@/components/fab'

import { getCatalog } from '@/lib/catalog'
import { prisma } from '@/lib/prisma'

import { auth } from '@/auth'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  if (!meId) redirect('/login')

  // Privacidad: el FAB solo ofrece MIS cuentas visibles. Nadie opera sobre
  // cuentas ajenas ni ocultas.
  const rows = await prisma.account.findMany({
    where: { isActive: true, isHidden: false, userId: meId },
    select: { id: true, name: true, type: true, color: true },
    orderBy: { createdAt: 'asc' },
  })
  const accounts = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as 'DEBIT' | 'CREDIT',
    color: r.color ?? '#6366f1',
  }))
  const catalog = await getCatalog(meId)
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="pt-safe flex flex-1 flex-col pb-44">{children}</main>
      <Fab accountOptions={accounts} cats={catalog} />
      <BottomNav />
    </div>
  )
}

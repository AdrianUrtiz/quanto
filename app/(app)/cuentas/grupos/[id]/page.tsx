import { redirect } from 'next/navigation'

import { GroupDetailClient } from '@/components/group-detail-client'

import { getCatalog } from '@/lib/catalog'
import { getGroupDetail } from '@/lib/group-actions'
import { prisma } from '@/lib/prisma'

import { auth } from '@/auth'

export async function generateMetadata() {
  return { title: 'Grupo' }
}

export default async function GrupoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  if (!meId) redirect('/login')
  const { id } = await params

  const detail = await getGroupDetail(id)
  if ('error' in detail) redirect('/cuentas')

  const [accRows, catalog] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true, isHidden: false, userId: meId },
      select: {
        id: true,
        name: true,
        type: true,
        color: true,
        isFavorite: true,
        position: true,
      },
      orderBy: [
        { isFavorite: 'desc' },
        { position: 'asc' },
        { createdAt: 'asc' },
      ],
    }),
    getCatalog(meId),
  ])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ok, ...rest } = detail

  return (
    <GroupDetailClient
      detail={rest}
      accountOptions={accRows.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        color: a.color ?? '#6366f1',
        isFavorite: a.isFavorite,
        position: a.position,
      }))}
      cats={catalog}
    />
  )
}

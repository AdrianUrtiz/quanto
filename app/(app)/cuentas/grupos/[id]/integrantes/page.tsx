import { redirect } from 'next/navigation'

import { GroupMembersClient } from '@/components/group-members-client'

import { getGroupDetail } from '@/lib/group-actions'

import { auth } from '@/auth'

export async function generateMetadata() {
  return { title: 'Integrantes' }
}

export default async function GrupoIntegrantesPage({
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

  // Solo participantes, sin saldos ni gastos.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ok, ...rest } = detail

  return (
    <GroupMembersClient
      householdId={rest.id}
      groupName={rest.name}
      isCreator={rest.isCreator}
      canEdit={rest.isCreator && rest.expenses.length === 0}
      members={rest.members.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        occupied: m.occupied,
        isMe: m.isMe,
        occupantName: m.occupantName,
      }))}
    />
  )
}

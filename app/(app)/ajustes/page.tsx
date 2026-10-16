import { AjustesClient } from '@/components/ajustes-client'

import { getPairingState } from '@/lib/couple-actions'
import { prisma } from '@/lib/prisma'

import { auth } from '@/auth'

export const metadata = { title: 'Ajustes' }

export default async function AjustesPage() {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  let username: string | undefined
  if (meId) {
    try {
      const me = await prisma.user.findUnique({
        where: { id: meId },
        select: { username: true },
      })
      username = me?.username
    } catch {
      username = undefined
    }
  }
  let pairing = null
  try {
    const res = await getPairingState()
    if ('ok' in res) {
      pairing = {
        pairCode: res.pairCode,
        partner: res.partner,
        householdId: res.householdId,
        sent: res.sent,
        received: res.received,
      }
    }
  } catch {
    pairing = null
  }

  return <AjustesClient username={username} initialPairing={pairing} />
}

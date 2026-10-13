import { NextResponse } from 'next/server'

import { getPairingInvites } from '@/lib/couple-actions'
import { getLineSums } from '@/lib/debt-payments'
import { SNAPSHOT_VERSION } from '@/lib/offline/db'
import { getPendingPaymentLists } from '@/lib/offline/snapshot-server'

import { auth } from '@/auth'

// Poll ligero para notificaciones (banners): pagos de pareja pendientes +
// solicitudes de vínculo + sus sumas. Mucho más barato que el snapshot
// completo, para que la app abierta se entere de lo que hizo la pareja
// sin esperar el ciclo de 15 min.
export async function GET() {
  const session = await auth()
  const userId = (session?.user as { id?: string } | undefined)?.id
  if (!userId)
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Configura DATABASE_URL para sincronizar' },
      { status: 503 },
    )
  }
  try {
    const [debtPayments, pairingInvites] = await Promise.all([
      getPendingPaymentLists(userId),
      getPairingInvites(userId),
    ])
    const shareIds = [
      ...debtPayments.toConfirm,
      ...debtPayments.myPending,
      ...debtPayments.toConfirmSource,
    ].map((p) => p.shareId)
    const sums = await getLineSums([...new Set(shareIds)])
    return NextResponse.json(
      {
        v: SNAPSHOT_VERSION,
        debtPayments,
        lineSums: [...sums.entries()].map(([key, s]) => ({
          key,
          confirmed: s.confirmed,
          pending: s.pending,
        })),
        pairingInvites,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json(
      { error: 'No se pudieron obtener actualizaciones' },
      { status: 500 },
    )
  }
}

import { NextResponse } from 'next/server'

import { buildSnapshot } from '@/lib/offline/snapshot-server'

import { auth } from '@/auth'

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
    const snapshot = await buildSnapshot(userId)
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      { error: 'No se pudo generar la copia local' },
      { status: 500 },
    )
  }
}

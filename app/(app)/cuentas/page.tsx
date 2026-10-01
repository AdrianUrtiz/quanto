import { redirect } from 'next/navigation'

import type { AccountRow } from '@/components/account-card'
import {
  CuentasClient,
  type MyPendingItem,
  type SourceConfirmItem,
  type ToConfirmItem,
} from '@/components/cuentas-client'
import type { SubRow } from '@/components/subscription-tab'

import { getAccountBalances } from '@/lib/balances'
import { payableInstallments } from '@/lib/calculations'
import { getCatalog } from '@/lib/catalog'
import { getLineSums } from '@/lib/debt-payments'
import { normalizeMoney } from '@/lib/money'
import {
  type DebtItemInput,
  buildDebts,
} from '@/lib/partner-debts'
import { prisma } from '@/lib/prisma'
import { getSubscriptionData } from '@/lib/subscription-actions'
import type { DueCharge } from '@/lib/subscriptions'
import { monthLabelEs } from '@/lib/utils'
import { mexicoMonthKey } from '@/lib/walltime'

import { auth } from '@/auth'

export const metadata = { title: 'Cuentas' }

export default async function CuentasPage({
  searchParams,
}: {
  searchParams?: Promise<{ editar?: string }>
}) {
  const session = await auth()
  const meId = (session?.user as { id?: string } | undefined)?.id
  if (!meId) redirect('/login')
  // Deep-link desde el recordatorio de renovación: abre la edición.
  const editAccountId = (await searchParams)?.editar ?? null
  const me = session?.user?.name ?? 'Tú'
  const key = mexicoMonthKey()

  let subs: SubRow[] = []
  let dues: DueCharge[] = []
  const toConfirm: ToConfirmItem[] = []
  const myPending: MyPendingItem[] = []
  const toConfirmSource: SourceConfirmItem[] = []
  const [accRows, sharedRows, sharedOwedRows] = await Promise.all([
    // Privacidad: ni siquiera se consultan las cuentas de la pareja.
    prisma.account.findMany({
      where: { isActive: true, userId: meId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Solo movimientos creados por mi pareja donde YO soy el deudor.
    prisma.transaction.findMany({
      where: {
        isShared: true,
        createdById: { not: meId },
        shares: { some: { debtorId: meId } },
      },
      include: {
        account: true,
        createdBy: true,
        shares: { where: { debtorId: meId } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
    // Compras MÍAS compartidas donde mi pareja es la deudora (me deben).
    prisma.transaction.findMany({
      where: {
        isShared: true,
        createdById: meId,
        shares: { some: { debtorId: { not: meId } } },
      },
      include: {
        account: true,
        createdBy: true,
        shares: { include: { debtor: true } },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  const balances = await getAccountBalances(meId)
  const allAccounts: AccountRow[] = accRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as 'DEBIT' | 'CREDIT',
    owner: a.user.name,
    ownerId: a.user.id,
    balance:
      balances.get(a.id) ??
      (a.type === 'DEBIT' ? normalizeMoney(a.initialBalance ?? 0) : 0),
    creditLimit: a.creditLimit ? normalizeMoney(a.creditLimit) : undefined,
    statementDay: a.statementDay ?? undefined,
    dueDay: a.dueDay ?? undefined,
    lastFour: a.lastFour ?? undefined,
    expiry: a.expiry ?? undefined,
    color: a.color ?? '#6366f1',
    isHidden: a.isHidden,
  }))
  // Visibles en listas/totales/selectores; ocultas solo en su tab.
  const accounts = allAccounts.filter((a) => !a.isHidden)
  const hiddenAccounts = allAccounts.filter((a) => a.isHidden)
  // Pagos de pareja: sumas por línea + pendientes donde participo.
  const allShareIds = [
    ...sharedRows.flatMap((t) => t.shares.map((s) => s.id)),
    ...sharedOwedRows.flatMap((t) => t.shares.map((s) => s.id)),
  ]
  const [sums, pendingRows, sourceRows] = await Promise.all([
    getLineSums(allShareIds),
    prisma.debtPayment.findMany({
      where: {
        status: 'PENDING',
        share: {
          OR: [{ debtorId: meId }, { transaction: { createdById: meId } }],
        },
      },
      include: {
        share: {
          include: {
            transaction: { include: { createdBy: true } },
            debtor: true,
          },
        },
        registeredBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    // Cobros que el acreedor dice recibidos y esperan que yo indique la cuenta origen.
    prisma.debtPayment.findMany({
      where: {
        status: 'CONFIRMED',
        debtorConfirmedAt: null,
        registeredById: { not: meId },
        share: { debtorId: meId },
      },
      include: {
        share: { include: { transaction: { include: { createdBy: true } } } },
        registeredBy: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  const monthLabelOf = (m: string) => {
    const [y, mo] = m.split('-').map(Number)
    return monthLabelEs(new Date(y, mo - 1, 1))
  }
  for (const p of pendingRows) {
    const base = {
      id: p.id,
      amount: normalizeMoney(p.amount),
      month: p.month,
      monthLabel: monthLabelOf(p.month),
      concept: p.share.transaction.concept,
      monthly: normalizeMoney(p.share.monthlyAmount),
      shareId: p.shareId,
    }
    if (p.registeredById === meId) {
      // Yo (deudor) lo registré → espera confirmación del acreedor.
      myPending.push({
        ...base,
        confirmerName: p.share.transaction.createdBy.name,
      })
    } else {
      // PENDING siempre lo registró el deudor → yo soy el acreedor que confirma.
      toConfirm.push({ ...base, registeredByName: p.registeredBy.name })
    }
  }
  for (const p of sourceRows) {
    toConfirmSource.push({
      id: p.id,
      amount: normalizeMoney(p.amount),
      month: p.month,
      monthLabel: monthLabelOf(p.month),
      concept: p.share.transaction.concept,
      creditorName: p.registeredBy.name,
    })
  }
  // Pareja: entradas serializables; el mes se agrupa en cliente (buildDebts)
  // para poder cambiar de periodo. `sums` cubre todos los meses (sin filtro).
  const debtItems: DebtItemInput[] = sharedRows.map((t) => ({
    shareId: t.shares[0]?.id ?? '',
    accountId: t.account.id,
    accountName: t.account.name,
    accountType: t.account.type as 'DEBIT' | 'CREDIT',
    dueDay: t.account.dueDay ?? undefined,
    statementDay: t.account.statementDay ?? undefined,
    debtorId: meId,
    debtorName: me,
    creditorName: t.createdBy.name,
    concept: t.concept,
    monthly: normalizeMoney(t.shares[0]?.monthlyAmount ?? 0),
    installments: t.installments,
    date: t.date.toISOString(),
  }))
  const owedItems: DebtItemInput[] = sharedOwedRows.flatMap((t) =>
    t.shares
      .filter((s) => s.debtorId !== meId)
      .map((s) => ({
        shareId: s.id,
        accountId: t.account.id,
        accountName: t.account.name,
        accountType: t.account.type as 'DEBIT' | 'CREDIT',
        dueDay: t.account.dueDay ?? undefined,
        statementDay: t.account.statementDay ?? undefined,
        debtorId: s.debtorId,
        debtorName: s.debtor.name,
        creditorName: t.createdBy.name,
        concept: t.concept,
        monthly: normalizeMoney(s.monthlyAmount ?? 0),
        installments: t.installments,
        date: t.date.toISOString(),
      })),
  )
  const sumsArr = [...sums.entries()].map(([k, s]) => ({
    key: k,
    confirmed: s.confirmed,
    pending: s.pending,
  }))

  // Meses con parcialidades exigibles (debo + me deben) para el selector.
  // En crédito con corte es el mes de vencimiento, no el de compra.
  const monthKeys = new Set<string>([key])
  for (const it of [...debtItems, ...owedItems])
    for (const p of payableInstallments(
      new Date(it.date),
      it.installments,
      it.statementDay,
      it.dueDay,
    ))
      monthKeys.add(p.dueKey)
  const partnerMonths = [...monthKeys]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((k) => {
      const [y, mo] = k.split('-').map(Number)
      const total =
        buildDebts(debtItems, k, sums).reduce((a, d) => a + d.remaining, 0) +
        buildDebts(owedItems, k, sums).reduce((a, d) => a + d.remaining, 0)
      return { key: k, label: monthLabelEs(new Date(y, mo - 1, 1)), total }
    })
  // Suscripciones (mías + compartidas de mi pareja) y sus pendientes.
  const subData = await getSubscriptionData(meId)
  subs = subData.subs
  dues = subData.dues

  const catalog = await getCatalog(meId)

  return (
    <>
      <CuentasClient
        accounts={accounts}
        hiddenAccounts={hiddenAccounts}
        meId={meId}
        editAccountId={editAccountId}
        debtItems={debtItems}
        owedItems={owedItems}
        sums={sumsArr}
        partnerMonths={partnerMonths}
        subs={subs}
        dues={dues}
        cats={catalog}
        toConfirm={toConfirm}
        myPending={myPending}
        toConfirmSource={toConfirmSource}
      />
    </>
  )
}

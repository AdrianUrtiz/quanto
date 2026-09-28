// Datos de prueba etiquetados con "[TEST]" para verificar la app de punta a punta:
// saldos calculados, estados de cuenta (MSI prorrateados), suscripciones
// (confirmadas + omitidas), gastos compartidos y pagos de pareja.
//
// Uso:
//   npx tsx prisma/seed-test.ts          → inserta datos de prueba
//   npx tsx prisma/seed-test.ts --clean  → borra TODO lo etiquetado [TEST]
//
// ATENCIÓN: corre contra DATABASE_URL de .env (la BD actual). Todo lo que
// crea va etiquetado para poder limpiarlo después.
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const adapter = new PrismaPg(process.env['DATABASE_URL'] ?? '')
const prisma = new PrismaClient({ adapter })

const TAG = '[TEST]'
const CLEAN = process.argv.includes('--clean')

// Aleatorio determinista para datos reproducibles.
let seed = 42
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}
function money(min: number, max: number) {
  return Math.round((min + rnd() * (max - min)) * 100) / 100
}
function monthKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthsBack(n: number, day: number, hour = 12) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1, hour, 0, 0)
  d.setDate(
    Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()),
  )
  return d
}

async function clean() {
  const testTxs = await prisma.transaction.findMany({
    where: { concept: { startsWith: TAG } },
    select: { id: true },
  })
  const txIds = testTxs.map((t) => t.id)
  if (txIds.length) {
    await prisma.debtPayment.deleteMany({
      where: {
        OR: [
          { transactionId: { in: txIds } },
          { debtorTransactionId: { in: txIds } },
        ],
      },
    })
    await prisma.subscriptionCharge.deleteMany({
      where: { transactionId: { in: txIds } },
    })
    await prisma.transaction.deleteMany({ where: { id: { in: txIds } } })
  }
  await prisma.debtPayment.deleteMany({
    where: { share: { transaction: { concept: { startsWith: TAG } } } },
  })
  await prisma.subscriptionCharge.deleteMany({
    where: { subscription: { name: { startsWith: TAG } } },
  })
  await prisma.transaction.deleteMany({
    where: { concept: { startsWith: TAG } },
  })
  await prisma.subscription.deleteMany({ where: { name: { startsWith: TAG } } })
  await prisma.account.deleteMany({ where: { name: { startsWith: TAG } } })
  console.log('Clean OK: datos [TEST] eliminados')
}

type Actor = { accId: string; userId: string; name: string }

async function main() {
  if (CLEAN) return clean()

  const adrian = await prisma.user.findUnique({ where: { username: 'adrian' } })
  const michi = await prisma.user.findUnique({ where: { username: 'michi' } })
  if (!adrian || !michi)
    throw new Error('Faltan usuarios alfa: corre `npm run db:seed` primero')

  // — Cuentas de prueba (2 por usuario) —
  const bbva = await prisma.account.create({
    data: {
      name: `${TAG} BBVA Débito`,
      type: 'DEBIT',
      userId: adrian.id,
      lastFour: '1234',
      color: '#1d4ed8',
      initialBalance: 20000,
    },
  })
  const nu = await prisma.account.create({
    data: {
      name: `${TAG} Nu Crédito`,
      type: 'CREDIT',
      userId: adrian.id,
      lastFour: '5678',
      color: '#7c3aed',
      creditLimit: 30000,
      statementDay: 15,
      dueDay: 26,
    },
  })
  const santander = await prisma.account.create({
    data: {
      name: `${TAG} Santander Débito`,
      type: 'DEBIT',
      userId: michi.id,
      lastFour: '9012',
      color: '#dc2626',
      initialBalance: 15000,
    },
  })
  const amex = await prisma.account.create({
    data: {
      name: `${TAG} Amex Crédito`,
      type: 'CREDIT',
      userId: michi.id,
      lastFour: '3456',
      color: '#0ea5e9',
      creditLimit: 50000,
    },
  })

  const A: Actor = { accId: bbva.id, userId: adrian.id, name: 'Adrián' }
  const ANu: Actor = { accId: nu.id, userId: adrian.id, name: 'Adrián' }
  const M: Actor = { accId: santander.id, userId: michi.id, name: 'Michi' }
  const MAm: Actor = { accId: amex.id, userId: michi.id, name: 'Michi' }

  let n = 0
  const tx = async (
    data: Parameters<typeof prisma.transaction.create>[0]['data'],
  ) => {
    n++
    return prisma.transaction.create({ data })
  }

  // — Nóminas mensuales (8 meses) —
  for (let m = 7; m >= 0; m--) {
    await tx({
      type: 'INCOME',
      amount: 25000,
      concept: `${TAG} Nómina`,
      category: 'NOMINA',
      date: monthsBack(m, 1),
      accountId: bbva.id,
      createdById: adrian.id,
    })
    await tx({
      type: 'INCOME',
      amount: 18000,
      concept: `${TAG} Nómina`,
      category: 'NOMINA',
      date: monthsBack(m, 1),
      accountId: santander.id,
      createdById: michi.id,
    })
  }

  // — Gastos chicos de débito dispersos (~12/mes × 9 meses) —
  const cats = [
    'COMIDA',
    'TRANSPORTE',
    'OCIO',
    'SALUD',
    'COMPRAS',
    'SERVICIOS',
    'EDUCACION',
    'MASCOTAS',
  ]
  const spots = [
    'Oxxo',
    'Uber',
    'Cine',
    'Farmacia',
    'Amazon',
    'Starbucks',
    'Gasolinera',
    'Mercado',
    'Luz',
    'Agua',
    'Internet',
    'Veterinaria',
    'Librería',
    'Taquería',
    'Metro',
    'Gym nutrióloga',
  ]
  for (let m = 8; m >= 0; m--) {
    for (let k = 0; k < 14; k++) {
      const owner = (m + k) % 2 === 0 ? A : M
      await tx({
        type: 'EXPENSE',
        amount: money(35, 1200),
        concept: `${TAG} ${pick(spots)}`,
        category: pick(cats),
        date: monthsBack(m, 1 + Math.floor(rnd() * 28)),
        accountId: owner.accId,
        createdById: owner.userId,
      })
    }
  }

  // — Cargos semanales a Nu (despensa, gasolina, etc. × 6 meses) —
  const nuSpots = [
    'Súper mensual',
    'Gasolina',
    'Farmacia',
    'Restaurante',
    'Oxxo',
    'Café',
  ] as const
  for (let m = 5; m >= 0; m--) {
    for (const s of nuSpots) {
      await tx({
        type: 'EXPENSE',
        amount: money(200, 3500),
        concept: `${TAG} ${s}`,
        category: s === 'Restaurante' ? 'COMIDA' : 'COMPRAS',
        date: monthsBack(m, 2 + Math.floor(rnd() * 26)),
        accountId: nu.id,
        createdById: adrian.id,
      })
    }
  }

  // — MSI en Nu (Adrián) —
  const msis = [
    { concept: 'Laptop', amount: 30000, n: 3, back: 1, day: 5 },
    { concept: 'Tele', amount: 24000, n: 6, back: 2, day: 20 },
    { concept: 'Refri', amount: 36000, n: 12, back: 4, day: 10 },
    { concept: 'Airpods', amount: 6000, n: 12, back: 6, day: 15 },
    { concept: 'Pantalla', amount: 12000, n: 6, back: 3, day: 22 },
    { concept: 'Tenis', amount: 4500, n: 3, back: 0, day: 2 },
    { concept: 'Colchón', amount: 18000, n: 12, back: 5, day: 28 },
  ]
  for (const msi of msis) {
    await tx({
      type: 'EXPENSE',
      amount: msi.amount,
      concept: `${TAG} ${msi.concept} ${msi.n}MSI`,
      category: 'COMPRAS',
      date: monthsBack(msi.back, msi.day),
      accountId: nu.id,
      createdById: adrian.id,
      installments: msi.n,
    })
  }
  // — Pagos a Nu desde BBVA (8 meses) —
  for (let m = 7; m >= 0; m--) {
    await tx({
      type: 'TRANSFER',
      amount: money(3000, 9000),
      concept: `${TAG} Pago Nu`,
      category: 'OTRO',
      date: monthsBack(m, 24),
      accountId: bbva.id,
      transferToAccountId: nu.id,
      createdById: adrian.id,
    })
  }
  // — Cargos a Amex (Michi, mes calendario × 8 meses × 3) —
  const amexSpots = ['Vuelo', 'Hotel', 'Restaurante'] as const
  for (let m = 8; m >= 0; m--) {
    for (const [i, s] of amexSpots.entries()) {
      await tx({
        type: 'EXPENSE',
        amount: money(800, 9000),
        concept: `${TAG} ${s} ${m}`,
        category: 'VIAJES',
        date: monthsBack(m, 5 + i * 8),
        accountId: amex.id,
        createdById: michi.id,
        installments: (m + i) % 4 === 0 ? 3 : 1,
      })
    }
  }
  // — Abonos a Amex (ingreso directo a crédito) —
  for (const m of [5, 2]) {
    await tx({
      type: 'INCOME',
      amount: money(2000, 5000),
      concept: `${TAG} Abono Amex`,
      category: 'TRANSFERENCIA',
      date: monthsBack(m, 26),
      accountId: amex.id,
      createdById: michi.id,
    })
  }

  // — Helpers de compartidos/pagos —
  const creditorConfirm = async (
    shareId: string,
    month: string,
    amount: number,
    owner: Actor,
    debtorName: string,
    concept: string,
    day: number,
    back: number,
  ) => {
    const income = await tx({
      type: 'INCOME',
      amount,
      concept: `${TAG} Pago de ${debtorName} · ${concept}`,
      category: 'TRANSFERENCIA',
      date: monthsBack(back, day),
      accountId: owner.accId,
      createdById: owner.userId,
    })
    await prisma.debtPayment.create({
      data: {
        shareId,
        month,
        amount,
        status: 'CONFIRMED',
        registeredById: owner.userId,
        confirmedById: owner.userId,
        accountId: owner.accId,
        transactionId: income.id,
      },
    })
  }
  const debtorPending = async (
    shareId: string,
    month: string,
    amount: number,
    debtor: Actor,
    creditorName: string,
    concept: string,
  ) => {
    const expense = await tx({
      type: 'EXPENSE',
      amount,
      concept: `${TAG} Pago a ${creditorName} · ${concept}`,
      category: 'OTRO',
      date: new Date(),
      accountId: debtor.accId,
      createdById: debtor.userId,
    })
    await prisma.debtPayment.create({
      data: {
        shareId,
        month,
        amount,
        status: 'PENDING',
        registeredById: debtor.userId,
        accountId: debtor.accId,
        transactionId: expense.id,
      },
    })
  }
  const shared = async (
    owner: Actor,
    debtorId: string,
    concept: string,
    amount: number,
    back: number,
    day: number,
    installments: number,
    sharePct = 50,
    fixed?: number,
  ) => {
    const t = await tx({
      type: 'EXPENSE',
      amount,
      concept: `${TAG} ${concept}`,
      category: 'COMIDA',
      date: monthsBack(back, day),
      accountId: owner.accId,
      createdById: owner.userId,
      installments,
      isShared: true,
    })
    const s = await prisma.transactionShare.create({
      data: {
        transactionId: t.id,
        debtorId,
        sharePct: fixed ? (fixed / amount) * 100 : sharePct,
        monthlyAmount: fixed
          ? Math.round((fixed / installments) * 100) / 100
          : Math.round(((amount * sharePct) / 100 / installments) * 100) / 100,
        isFixedAmount: Boolean(fixed),
      },
    })
    return { t, s }
  }

  // — Compartidos de Adrián (debe Michi) —
  const c1 = await shared(ANu, michi.id, 'Cena aniversario', 3000, 2, 14, 3)
  await creditorConfirm(
    c1.s.id,
    monthKeyOf(monthsBack(2, 14)),
    500,
    A,
    'Michi',
    'Cena',
    20,
    2,
  )
  await creditorConfirm(
    c1.s.id,
    monthKeyOf(monthsBack(1, 14)),
    500,
    A,
    'Michi',
    'Cena',
    20,
    1,
  )
  await debtorPending(c1.s.id, monthKeyOf(new Date()), 500, M, 'Adrián', 'Cena')

  const c2 = await shared(ANu, michi.id, 'Súper compartido', 1200, 1, 9, 1)
  await creditorConfirm(
    c2.s.id,
    monthKeyOf(monthsBack(1, 9)),
    600,
    A,
    'Michi',
    'Súper',
    15,
    1,
  )

  const c3 = await shared(ANu, michi.id, 'Concierto', 6000, 3, 21, 6)
  await creditorConfirm(
    c3.s.id,
    monthKeyOf(monthsBack(3, 21)),
    500,
    A,
    'Michi',
    'Concierto',
    25,
    3,
  )
  await debtorPending(
    c3.s.id,
    monthKeyOf(monthsBack(2, 21)),
    500,
    M,
    'Adrián',
    'Concierto',
  )

  await shared(ANu, michi.id, 'Renta Airbnb', 5000, 0, 4, 1, 50, 2500)

  // — Compartidos de Michi (debe Adrián) —
  const c5 = await shared(MAm, adrian.id, 'Vuelo playa 6MSI', 6000, 3, 7, 6)
  await creditorConfirm(
    c5.s.id,
    monthKeyOf(monthsBack(3, 7)),
    500,
    M,
    'Adrián',
    'Vuelo',
    12,
    3,
  )
  await creditorConfirm(
    c5.s.id,
    monthKeyOf(monthsBack(2, 7)),
    500,
    M,
    'Adrián',
    'Vuelo',
    12,
    2,
  )

  const c6 = await shared(MAm, adrian.id, 'Hotel playa', 4500, 1, 11, 1)
  await creditorConfirm(
    c6.s.id,
    monthKeyOf(monthsBack(1, 11)),
    2250,
    M,
    'Adrián',
    'Hotel',
    18,
    1,
  )

  const c7 = await shared(MAm, adrian.id, 'Restaurante playa', 1800, 0, 6, 1)
  await debtorPending(
    c7.s.id,
    monthKeyOf(new Date()),
    900,
    A,
    'Michi',
    'Restaurante',
  )

  const c8 = await shared(ANu, michi.id, 'Pizzas viernes', 950, 0, 19, 1)
  await creditorConfirm(
    c8.s.id,
    monthKeyOf(monthsBack(0, 19)),
    475,
    A,
    'Michi',
    'Pizzas',
    22,
    0,
  )

  const c9 = await shared(MAm, adrian.id, 'Teatro', 2400, 1, 16, 3)
  await creditorConfirm(
    c9.s.id,
    monthKeyOf(monthsBack(1, 16)),
    400,
    M,
    'Adrián',
    'Teatro',
    20,
    1,
  )
  await debtorPending(
    c9.s.id,
    monthKeyOf(new Date()),
    400,
    A,
    'Michi',
    'Teatro',
  )

  // — Suscripciones de Adrián —
  const now = new Date()
  const startMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const mkSub = (
    name: string,
    amount: number,
    chargeDay: number,
    isShared: boolean,
    sharePct = 50,
  ) =>
    prisma.subscription.create({
      data: {
        userId: adrian.id,
        name: `${TAG} ${name}`,
        amount,
        category: 'SUSCRIPCIONES',
        accountId: nu.id,
        chargeDay,
        isShared,
        sharePct,
        startMonth,
      },
    })
  const netflix = await mkSub('Netflix', 219, 5, true)
  const gym = await mkSub('Gimnasio', 599, 28, false)
  const spotify = await mkSub('Spotify', 129, 20, false)
  const disney = await mkSub('Disney+', 179, 12, true)

  const confirmCharge = async (
    subId: string,
    name: string,
    amount: number,
    back: number,
    day: number,
    sharedSub: boolean,
  ) => {
    const key = monthKeyOf(monthsBack(back, day))
    const charge = await tx({
      type: 'EXPENSE',
      amount,
      concept: `${TAG} ${name}`,
      category: 'SUSCRIPCIONES',
      date: monthsBack(back, day),
      accountId: nu.id,
      createdById: adrian.id,
      isShared: sharedSub,
      subscriptionId: subId,
    })
    if (sharedSub) {
      await prisma.transactionShare.create({
        data: {
          transactionId: charge.id,
          debtorId: michi.id,
          sharePct: 50,
          monthlyAmount: Math.round((amount / 2) * 100) / 100,
        },
      })
    }
    await prisma.subscriptionCharge.create({
      data: {
        subscriptionId: subId,
        month: key,
        transactionId: charge.id,
        ownerPaid: true,
        ownerPaidById: adrian.id,
        ownerPaidAt: new Date(),
      },
    })
  }
  for (let m = 6; m >= 1; m--)
    await confirmCharge(netflix.id, 'Netflix', 219, m, 5, true)
  for (const m of [4, 3, 2, 1])
    await confirmCharge(gym.id, 'Gimnasio', 599, m, 28, false)
  for (const m of [3, 2, 1])
    await confirmCharge(spotify.id, 'Spotify', 129, m, 20, false)
  for (const m of [2, 1])
    await confirmCharge(disney.id, 'Disney+', 179, m, 12, true)
  await prisma.subscriptionCharge.create({
    data: {
      subscriptionId: gym.id,
      month: monthKeyOf(monthsBack(5, 28)),
      skipped: true,
    },
  })
  await prisma.subscriptionCharge.create({
    data: {
      subscriptionId: disney.id,
      month: monthKeyOf(monthsBack(3, 12)),
      skipped: true,
    },
  })

  console.log(`Seed TEST OK: ~${n} movimientos + cuentas/suscripciones [TEST]`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

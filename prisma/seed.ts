import { PrismaClient, AccountType, TransactionType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Usuarios iniciales de la pareja. Cambia emails/nombres por los reales.
// Login demo: adrian@quanto.app / pareja@quanto.app — password: quanto123
async function main() {
  const password = await bcrypt.hash("quanto123", 10);

  // Catálogo global de categorías (userId null = visible para todos).
  const defaults: { code: string; name: string; iconName: string; color: string; kind: string }[] = [
    { code: "COMIDA", name: "Comida", iconName: "UtensilsCrossed", color: "#fb923c", kind: "expense" },
    { code: "TRANSPORTE", name: "Transporte", iconName: "Car", color: "#38bdf8", kind: "expense" },
    { code: "VIVIENDA", name: "Vivienda", iconName: "House", color: "#a78bfa", kind: "expense" },
    { code: "SERVICIOS", name: "Servicios", iconName: "Lightbulb", color: "#facc15", kind: "expense" },
    { code: "SALUD", name: "Salud", iconName: "HeartPulse", color: "#f87171", kind: "expense" },
    { code: "OCIO", name: "Ocio", iconName: "Clapperboard", color: "#e879f9", kind: "expense" },
    { code: "COMPRAS", name: "Compras", iconName: "ShoppingBag", color: "#ec4899", kind: "expense" },
    { code: "EDUCACION", name: "Educación", iconName: "GraduationCap", color: "#818cf8", kind: "expense" },
    { code: "VIAJES", name: "Viajes", iconName: "Plane", color: "#22d3ee", kind: "expense" },
    { code: "MASCOTAS", name: "Mascotas", iconName: "PawPrint", color: "#a3e635", kind: "expense" },
    { code: "SUSCRIPCIONES", name: "Suscripciones", iconName: "Repeat", color: "#94a3b8", kind: "expense" },
    { code: "NOMINA", name: "Nómina", iconName: "Briefcase", color: "#34d399", kind: "income" },
    { code: "TRANSFERENCIA", name: "Transferencia", iconName: "Banknote", color: "#2dd4bf", kind: "income" },
    { code: "OTRO", name: "Otro", iconName: "Shapes", color: "#71717a", kind: "both" },
  ];
  for (const c of defaults) {
    // findFirst porque el único (userId null) no se puede buscar por where único.
    const existing = await prisma.category.findFirst({ where: { userId: null, code: c.code } });
    if (!existing) {
      await prisma.category.create({ data: { ...c, userId: null, isDefault: true } });
    }
  }

  const adrian = await prisma.user.upsert({
    where: { email: "adrian@quanto.app" },
    update: {},
    create: {
      email: "adrian@quanto.app",
      name: "Adrián",
      password,
      avatar: null,
    },
  });

  const pareja = await prisma.user.upsert({
    where: { email: "laura@quanto.app" },
    update: {},
    create: {
      email: "laura@quanto.app",
      name: "Laura",
      password,
      avatar: null,
    },
  });

  // Cuentas de Adrián
  const debitoAdrian = await prisma.account.upsert({
    where: { id: "seed-debito-adrian" },
    update: {},
    create: {
      id: "seed-debito-adrian",
      name: "Main account",
      type: AccountType.DEBIT,
      userId: adrian.id,
      lastFour: "1234",
      color: "#6366f1",
      initialBalance: 15000,
      balance: 15000,
    },
  });

  const creditoAdrian = await prisma.account.upsert({
    where: { id: "seed-credito-adrian" },
    update: {},
    create: {
      id: "seed-credito-adrian",
      name: "Tarjeta Crédito",
      type: AccountType.CREDIT,
      userId: adrian.id,
      lastFour: "5678",
      color: "#a855f7",
      creditLimit: 50000,
      statementDay: 15,
      dueDay: 5,
      balance: 3000, // deuda del ejemplo MSI
    },
  });

  // Cuenta de la pareja
  await prisma.account.upsert({
    where: { id: "seed-debito-pareja" },
    update: {},
    create: {
      id: "seed-debito-pareja",
      name: "Débito Pareja",
      type: AccountType.DEBIT,
      userId: pareja.id,
      lastFour: "9876",
      color: "#22c55e",
      initialBalance: 8000,
      balance: 8000,
    },
  });

  // Ejemplo: gasto compartido $3,000 MXN a 3 MSI en tarjeta de Adrián.
  // Cuota total $1,000/mes → la pareja aporta $500/mes a Adrián.
  const existing = await prisma.transaction.findFirst({
    where: { concept: "Super compartido (ejemplo MSI)" },
  });

  if (!existing) {
    const tx = await prisma.transaction.create({
      data: {
        type: TransactionType.EXPENSE,
        amount: 3000,
        concept: "Super compartido (ejemplo MSI)",
        category: "COMIDA",
        date: new Date(),
        accountId: creditoAdrian.id,
        createdById: adrian.id,
        installments: 3,
        isShared: true,
      },
    });

    await prisma.transactionShare.create({
      data: {
        transactionId: tx.id,
        debtorId: pareja.id, // la pareja le debe a Adrián
        sharePct: 50,
        monthlyAmount: 500, // 3000 * 0.5 / 3
      },
    });

    // Refleja la deuda en la tarjeta
    await prisma.account.update({
      where: { id: creditoAdrian.id },
      data: { balance: { increment: 3000 } },
    });
  }

  // Débito seed sin duplicar en cada run
  const n = await prisma.transaction.count({ where: { accountId: debitoAdrian.id } });
  if (n === 0) {
    await prisma.transaction.create({
      data: {
        type: TransactionType.INCOME,
        amount: 20000,
        concept: "Nómina",
        category: "NOMINA",
        date: new Date(),
        accountId: debitoAdrian.id,
        createdById: adrian.id,
        installments: 1,
      },
    });
  }

  console.log("Seed OK:", { adrian: adrian.email, pareja: pareja.email });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

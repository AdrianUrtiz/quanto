"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { moveBalance } from "@/lib/actions";
import { debtorMonthlyAmount } from "@/lib/calculations";
import { checkCategory } from "@/lib/catalog";
import { chargeDate } from "@/lib/subscriptions";
import { createCreditorIncome, getLineSums, lineKey, type TxDb } from "@/lib/debt-payments";
import type { Prisma } from "@prisma/client";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const SubSchema = z.object({
  name: z.string().min(2, "Ponle un nombre"),
  amount: z.coerce.number().positive("Monto debe ser mayor a 0"),
  category: z.string().default("SUSCRIPCIONES"),
  accountId: z.string().min(1, "Elige una cuenta"),
  chargeDay: z.coerce.number().min(1, "Día 1-31").max(31, "Día 1-31"),
  isShared: z.coerce.boolean().default(false),
  sharePct: z.coerce.number().min(1).max(99).default(50),
  shareAmount: z.coerce.number().positive().optional(),
});

function authedUser(session: Session | null) {
  return (session?.user as { id?: string } | undefined)?.id;
}

function revalidateAll() {
  revalidatePath("/actividad");
  revalidatePath("/resumen");
  revalidatePath("/cuentas");
}

export async function createSubscription(formData: FormData) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const raw = Object.fromEntries(formData);
  const parsed = SubSchema.safeParse({ ...raw, isShared: raw.isShared === "on" || raw.isShared === "true" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  const catError = await checkCategory(userId, v.category, "EXPENSE");
  if (catError) return { error: catError };

  const account = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!account) return { error: "Cuenta no encontrada" };
  if (v.isShared && v.shareAmount && v.shareAmount >= v.amount) {
    return { error: "La aportación debe ser menor al total" };
  }

  const now = new Date();
  await prisma.subscription.create({
    data: {
      userId,
      name: v.name.trim(),
      amount: v.amount,
      category: v.category,
      accountId: v.accountId,
      chargeDay: Math.round(v.chargeDay),
      isShared: v.isShared,
      sharePct: v.isShared ? v.sharePct : 50,
      shareAmount: v.isShared ? (v.shareAmount ?? null) : null,
      startMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    },
  });

  revalidateAll();
  return { ok: true };
}

export async function updateSubscription(formData: FormData) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const raw = Object.fromEntries(formData);
  const parsed = SubSchema.extend({ id: z.string().min(1) }).safeParse({
    ...raw,
    isShared: raw.isShared === "on" || raw.isShared === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  const catError = await checkCategory(userId, v.category, "EXPENSE");
  if (catError) return { error: catError };

  const sub = await prisma.subscription.findFirst({ where: { id: v.id, userId } });
  if (!sub) return { error: "Suscripción no encontrada" };
  const account = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!account) return { error: "Cuenta no encontrada" };
  if (v.isShared && v.shareAmount && v.shareAmount >= v.amount) {
    return { error: "La aportación debe ser menor al total" };
  }

  // Solo afecta cargos futuros: lo ya confirmado es inmutable.
  await prisma.subscription.update({
    where: { id: v.id },
    data: {
      name: v.name.trim(),
      amount: v.amount,
      category: v.category,
      accountId: v.accountId,
      chargeDay: Math.round(v.chargeDay),
      isShared: v.isShared,
      sharePct: v.isShared ? v.sharePct : sub.sharePct,
      shareAmount: v.isShared ? (v.shareAmount ?? null) : null,
    },
  });

  revalidateAll();
  return { ok: true };
}

export async function toggleSubscription(id: string, active: boolean) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const sub = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!sub) return { error: "Suscripción no encontrada" };

  await prisma.subscription.update({ where: { id }, data: { isActive: active } });
  revalidateAll();
  return { ok: true };
}

export async function deleteSubscription(id: string) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const sub = await prisma.subscription.findFirst({ where: { id, userId } });
  if (!sub) return { error: "Suscripción no encontrada" };

  // Los cargos ya confirmados se conservan (subscriptionId → null).
  await prisma.subscription.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}

// Confirma un cargo pendiente: crea el movimiento real con su split y saldo.
export async function confirmSubscriptionCharge(subscriptionId: string, month: string) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };
  if (!MONTH_RE.test(month)) return { error: "Mes inválido" };

  const sub = await prisma.subscription.findFirst({
    where: { id: subscriptionId, userId },
    include: { account: true },
  });
  if (!sub) return { error: "Suscripción no encontrada" };

  try {
    await confirmChargeCore(prisma, sub, month, userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo confirmar" };
  }
  revalidateAll();
  return { ok: true };
}

type SubWithAccount = Prisma.SubscriptionGetPayload<{ include: { account: true } }>;

/**
 * Núcleo de confirmación: crea el gasto + split + saldo. Lanza Error si
 * ya existe, está pausada o no hay deudor. Corre dentro o fuera de tx.
 */
async function confirmChargeCore(db: TxDb, sub: SubWithAccount, month: string, userId: string) {
  if (!sub.isActive) throw new Error("La suscripción está pausada");

  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const existing = await db.transaction.findFirst({
    where: { subscriptionId: sub.id, date: { gte: start, lt: end }, createdById: userId },
    select: { id: true },
  });
  if (existing) throw new Error("Este cargo ya fue confirmado");

  const amount = Number(sub.amount);
  const date = chargeDate(month, sub.chargeDay);

  let debtorId: string | null = null;
  if (sub.isShared) {
    const other = await db.user.findFirst({ where: { id: { not: userId } } });
    debtorId = other?.id ?? null;
    if (!debtorId || debtorId === userId) throw new Error("No se pudo determinar quién debe aportar");
  }

  const tx = await db.transaction.create({
    data: {
      type: "EXPENSE",
      amount,
      concept: sub.name,
      category: sub.category,
      date,
      accountId: sub.accountId,
      createdById: userId,
      installments: 1,
      isShared: sub.isShared,
      subscriptionId: sub.id,
    },
  });

  let share: { id: string; debtorId: string; monthlyAmount: unknown } | null = null;
  if (sub.isShared && debtorId) {
    const fixed = sub.shareAmount ? Number(sub.shareAmount) : null;
    share = await db.transactionShare.create({
      data: {
        transactionId: tx.id,
        debtorId,
        sharePct: fixed ? (fixed / amount) * 100 : sub.sharePct,
        monthlyAmount: fixed ?? debtorMonthlyAmount(amount, 1, sub.sharePct),
        isFixedAmount: Boolean(fixed),
      },
      select: { id: true, debtorId: true, monthlyAmount: true },
    });
  }

  if (db === prisma) {
    await moveBalance(sub.accountId, sub.account.type, "EXPENSE", amount, 1);
  } else {
    await db.account.update({
      where: { id: sub.accountId },
      data:
        sub.account.type === "CREDIT" ? { balance: { increment: amount } } : { balance: { decrement: amount } },
    });
  }
  return { tx, share };
}

const SubPaySchema = z.object({
  subscriptionId: z.string().min(1),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido"),
  who: z.enum(["me", "partner"]),
  amount: z.coerce.number().positive("El monto debe ser mayor a 0").optional(),
  accountId: z.string().optional(),
});

/**
 * Pagos a una suscripción (solo yo gestiono mis suscripciones → sin confirmación).
 * - Solo + who=me: confirma el cargo (gasto en su cuenta).
 * - Compartida + who=me ("Pagué yo"): confirma el cargo (gasto total + deuda de ella).
 * - Compartida + who=partner ("Pagó mi pareja"): confirma el cargo si falta y
 *   registra su cobro (CONFIRMED + ingreso en mi cuenta, admite abonos).
 */
export async function registerSubscriptionPayment(formData: FormData) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const parsed = SubPaySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  const sub = await prisma.subscription.findFirst({
    where: { id: v.subscriptionId, userId },
    include: { account: true },
  });
  if (!sub) return { error: "Suscripción no encontrada" };
  if (!sub.isActive) return { error: "La suscripción está pausada" };
  if (v.who === "partner" && !sub.isShared) return { error: "Esta suscripción no es compartida" };

  // Solo mía (o "Pagué yo" sin más): confirmar el cargo basta.
  if (v.who === "me") {
    try {
      await confirmChargeCore(prisma, sub, v.month, userId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "No se pudo registrar" };
    }
    revalidateAll();
    return { ok: true };
  }

  // "Pagó mi pareja": cuenta destino propia obligatoria.
  const accountId = v.accountId || null;
  if (!accountId) return { error: "Elige la cuenta donde recibiste" };
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { error: "Cuenta no encontrada" };
  const catError = await checkCategory(userId, "TRANSFERENCIA", "INCOME");
  if (catError) return { error: catError };

  try {
    await prisma.$transaction(async (db) => {
      // Cargo confirmado (o se confirma ahora mismo) + su aportación.
      let shareId: string;
      let monthly: number;
      let debtorId: string;
      let debtorName: string;
      let concept: string;
      const [y, m] = v.month.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      const existingTx = await db.transaction.findFirst({
        where: { subscriptionId: sub.id, date: { gte: start, lt: end }, createdById: userId },
        select: { id: true, concept: true },
      });
      if (existingTx) {
        const sh = await db.transactionShare.findFirst({
          where: { transactionId: existingTx.id },
          include: { debtor: true },
        });
        if (!sh) throw new Error("El cargo no generó aportación de pareja");
        shareId = sh.id;
        monthly = Number(sh.monthlyAmount);
        debtorId = sh.debtorId;
        debtorName = sh.debtor.name;
        concept = existingTx.concept;
      } else {
        const { tx, share } = await confirmChargeCore(db, sub, v.month, userId);
        if (!share) throw new Error("No se pudo crear la aportación");
        const debt = await db.user.findUnique({ where: { id: share.debtorId }, select: { name: true } });
        shareId = share.id;
        monthly = Number(share.monthlyAmount);
        debtorId = share.debtorId;
        debtorName = debt?.name ?? "pareja";
        concept = tx.concept;
      }
      if (debtorId === userId) throw new Error("No puedes cobrarte a ti mismo");

      const sums = await getLineSums([shareId], db);
      const rest = Math.max(0, monthly - (sums.get(lineKey(shareId, v.month))?.confirmed ?? 0));
      const amt = v.amount ?? rest;
      if (rest <= 0.005) throw new Error("Su parte ya está liquidada");
      if (amt - rest > 0.005) throw new Error(`Solo restan $${rest.toLocaleString("es-MX", { maximumFractionDigits: 2 })}`);

      const incomeId = await createCreditorIncome(db, {
        amount: amt,
        concept: `Pago de ${debtorName} · ${concept}`,
        accountId,
        accountType: account.type,
        userId,
      });
      await db.debtPayment.create({
        data: {
          shareId,
          month: v.month,
          amount: amt,
          status: "CONFIRMED",
          registeredById: userId,
          confirmedById: userId,
          accountId,
          transactionId: incomeId,
        },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo registrar" };
  }
  revalidateAll();
  return { ok: true };
}

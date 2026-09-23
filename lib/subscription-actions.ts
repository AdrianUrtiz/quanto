"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { moveBalance } from "@/lib/actions";
import { debtorMonthlyAmount } from "@/lib/calculations";
import { isValidCategory } from "@/lib/categories";
import { chargeDate } from "@/lib/subscriptions";

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
  if (!isValidCategory(v.category)) return { error: "Categoría inválida" };

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
  if (!isValidCategory(v.category)) return { error: "Categoría inválida" };

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
  if (!sub.isActive) return { error: "La suscripción está pausada" };

  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const existing = await prisma.transaction.findFirst({
    where: { subscriptionId, date: { gte: start, lt: end }, createdById: userId },
    select: { id: true },
  });
  if (existing) return { error: "Este cargo ya fue confirmado" };

  const amount = Number(sub.amount);
  const date = chargeDate(month, sub.chargeDay);

  let debtorId: string | null = null;
  if (sub.isShared) {
    const other = await prisma.user.findFirst({ where: { id: { not: userId } } });
    debtorId = other?.id ?? null;
    if (!debtorId || debtorId === userId) return { error: "No se pudo determinar quién debe aportar" };
  }

  const tx = await prisma.transaction.create({
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

  if (sub.isShared && debtorId) {
    const fixed = sub.shareAmount ? Number(sub.shareAmount) : null;
    await prisma.transactionShare.create({
      data: {
        transactionId: tx.id,
        debtorId,
        sharePct: fixed ? (fixed / amount) * 100 : sub.sharePct,
        monthlyAmount: fixed ?? debtorMonthlyAmount(amount, 1, sub.sharePct),
        isFixedAmount: Boolean(fixed),
      },
    });
  }

  await moveBalance(sub.accountId, sub.account.type, "EXPENSE", amount, 1);

  revalidateAll();
  return { ok: true };
}

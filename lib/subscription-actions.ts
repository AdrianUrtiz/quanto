"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { debtorMonthlyAmount } from "@/lib/calculations";
import { checkCategory } from "@/lib/catalog";
import {
  chargeDate,
  computeDues,
  monthHistory,
  type ChargeRow,
  type DueCharge,
  type SubInfo,
} from "@/lib/subscriptions";

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

function partsOf(v: { amount: number; isShared: boolean; sharePct?: number; shareAmount?: number }) {
  if (!v.isShared) return { sharePct: 50, shareAmount: null as number | null };
  if (v.shareAmount != null && v.shareAmount >= v.amount) {
    return { error: "La aportación debe ser menor al total" };
  }
  return { sharePct: v.sharePct ?? 50, shareAmount: v.shareAmount ?? null };
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
  const parts = partsOf(v);
  if ("error" in parts) return { error: parts.error };

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
      sharePct: parts.sharePct,
      shareAmount: parts.shareAmount,
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
  const parts = partsOf(v);
  if ("error" in parts) return { error: parts.error };

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
      sharePct: parts.sharePct,
      shareAmount: parts.shareAmount,
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

  // Los cargos ya confirmados se conservan como movimientos normales.
  await prisma.subscription.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}

/**
 * Confirmar cobro (solo el dueño): registra el hecho indivisible — gasto total
 * en la tarjeta — y SI genera la deuda de la pareja (split), visible en Pareja.
 * Nace ownerPaid=true. Los pagos de esa deuda se registran en Pareja, no aquí.
 */
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

  const existing = await prisma.subscriptionCharge.findUnique({
    where: { subscriptionId_month: { subscriptionId, month } },
    select: { id: true },
  });
  if (existing) return { error: "Este cargo ya fue confirmado" };

  const amount = Number(sub.amount);
  // Todo indivisible en una transacción: gasto + share + cargo.
  // El saldo se deriva por suma (lib/balances.ts).
  try {
    await prisma.$transaction(async (db) => {
      const tx = await db.transaction.create({
        data: {
          type: "EXPENSE",
          amount,
          concept: sub.name,
          category: sub.category,
          date: chargeDate(month, sub.chargeDay),
          accountId: sub.accountId,
          createdById: userId,
          installments: 1,
          isShared: sub.isShared,
          subscriptionId: sub.id,
        },
      });

      if (sub.isShared) {
        const other = await db.user.findFirst({ where: { id: { not: userId } }, select: { id: true } });
        const debtorId = other?.id;
        if (!debtorId || debtorId === userId) throw new Error("No se pudo determinar quién debe aportar");
        const fixed = sub.shareAmount ? Number(sub.shareAmount) : null;
        await db.transactionShare.create({
          data: {
            transactionId: tx.id,
            debtorId,
            sharePct: fixed ? (fixed / amount) * 100 : sub.sharePct,
            monthlyAmount: fixed ?? debtorMonthlyAmount(amount, 1, sub.sharePct),
            isFixedAmount: Boolean(fixed),
          },
        });
      }

      await db.subscriptionCharge.create({
        data: {
          subscriptionId: sub.id,
          month,
          transactionId: tx.id,
          ownerPaid: true,
          ownerPaidById: userId,
          ownerPaidAt: new Date(),
          partnerPaid: false,
        },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo confirmar el cargo" };
  }

  revalidateAll();
  return { ok: true };
}

export type SubFull = {
  id: string;
  name: string;
  amount: number;
  category: string;
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  chargeDay: number;
  isShared: boolean;
  sharePct: number;
  shareAmount: number | null;
  isActive: boolean;
  startMonth: string;
  ownerId: string;
  ownerName: string;
  isMine: boolean;
  partnerName: string | null;
  history: { monthKey: string; short: string; confirmed: boolean; partnerPaid: boolean; isShared: boolean }[];
};

/**
 * Todo lo de suscripciones para un usuario en una sola llamada: plantillas
 * propias + compartidas de la pareja (sin saldos ajenos) y cargos pendientes.
 */
export async function getSubscriptionData(userId: string): Promise<{ subs: SubFull[]; dues: DueCharge[] }> {
  if (!process.env.DATABASE_URL || !userId) return { subs: [], dues: [] };
  try {
    const [me, partner, mySubs, partnerSubs] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.user.findFirst({ where: { id: { not: userId } }, select: { id: true, name: true } }),
      prisma.subscription.findMany({
        where: { userId },
        include: { account: true, user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.subscription.findMany({
        where: { userId: { not: userId }, isShared: true },
        include: {
          account: { select: { id: true, type: true } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    if (!me) return { subs: [], dues: [] };
    // Nombre del otro miembro (para "¿Te pagó X?"). En las suyas es la dueña.
    const partnerName = partner?.name ?? null;

    const infos: SubInfo[] = [
      ...mySubs.map((s) => ({
        id: s.id,
        name: s.name,
        amount: Number(s.amount),
        category: s.category,
        accountId: s.accountId,
        accountName: s.account.name,
        accountType: s.account.type as "DEBIT" | "CREDIT",
        chargeDay: s.chargeDay,
        isShared: s.isShared,
        sharePct: s.sharePct,
        shareAmount: s.shareAmount ? Number(s.shareAmount) : null,
        isActive: s.isActive,
        startMonth: s.startMonth,
        ownerId: userId,
        ownerName: me.name,
        isMine: true,
        partnerName,
      })),
      ...partnerSubs.map((s) => ({
        id: s.id,
        name: s.name,
        amount: Number(s.amount),
        category: s.category,
        accountId: s.accountId,
        accountName: `Tarjeta de ${s.user.name}`,
        accountType: s.account.type as "DEBIT" | "CREDIT",
        chargeDay: s.chargeDay,
        isShared: s.isShared,
        sharePct: s.sharePct,
        shareAmount: s.shareAmount ? Number(s.shareAmount) : null,
        isActive: s.isActive,
        startMonth: s.startMonth,
        ownerId: "",
        ownerName: s.user.name,
        isMine: false,
        partnerName: s.user.name,
      })),
    ];

    const charges = await prisma.subscriptionCharge.findMany({
      where: { subscriptionId: { in: infos.map((s) => s.id) } },
      include: {
        ownerPaidBy: { select: { name: true } },
        partnerPaidBy: { select: { name: true } },
      },
    });
    const chargeMap = new Map<string, ChargeRow>(
      charges.map((c) => [
        `${c.subscriptionId}:${c.month}`,
        {
          subscriptionId: c.subscriptionId,
          month: c.month,
          transactionId: c.transactionId,
          ownerPaid: c.ownerPaid,
          partnerPaid: c.partnerPaid,
          ownerPaidByName: c.ownerPaidBy?.name ?? null,
          partnerPaidByName: c.partnerPaidBy?.name ?? null,
        },
      ]),
    );

    const dues = computeDues(infos, chargeMap);
    const subs: SubFull[] = infos.map((s) => ({
      ...s,
      history: monthHistory(s, chargeMap).map((h) => ({ ...h })),
    }));

    return { subs, dues };
  } catch {
    return { subs: [], dues: [] };
  }
}




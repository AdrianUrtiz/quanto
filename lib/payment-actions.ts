"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { installmentMonths } from "@/lib/calculations";
import { checkCategory } from "@/lib/catalog";
import { getLineSums, lineKey, lineRemaining } from "@/lib/debt-payments";

function revalidateDebts() {
  revalidatePath("/cuentas");
  revalidatePath("/resumen");
  revalidatePath("/actividad");
}

async function meId() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function noDb() {
  return !process.env.DATABASE_URL
    ? { error: "Configura DATABASE_URL para registrar pagos" }
    : null;
}

const RegisterSchema = z.object({
  shareId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido"),
  amount: z.coerce.number().positive("El monto debe ser mayor a 0"),
  accountId: z.string().optional(),
});

/**
 * Registra un abono a la parcialidad (shareId, month) de un gasto compartido.
 * - Si registra el ACREEDOR (recibe): CONFIRMED directo + ingreso en su cuenta.
 * - Si registra el DEUDOR (paga): PENDING hasta que el acreedor confirma
 *   (+ egreso opcional en su propia cuenta al registrar).
 * El movimiento siempre lo crea el dueño de la cuenta.
 */
export async function registerPayment(formData: FormData) {
  const userId = await meId();
  if (!userId) return { error: "No autenticado" };
  const dbErr = noDb();
  if (dbErr) return dbErr;

  const parsed = RegisterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  const share = await prisma.transactionShare.findUnique({
    where: { id: v.shareId },
    include: { transaction: { include: { createdBy: true } } },
  });
  if (!share) return { error: "Aportación no encontrada" };
  const tx = share.transaction;
  const debtorId = share.debtorId;
  const creditorId = tx.createdById;
  if (userId !== debtorId && userId !== creditorId) {
    return { error: "No participas en esta deuda" };
  }

  // La parcialidad debe existir (mes >= compra y dentro de los MSI).
  const months = installmentMonths(new Date(tx.date), tx.installments);
  if (!months.includes(v.month)) return { error: "Esa parcialidad no corresponde a este gasto" };

  const monthly = Number(share.monthlyAmount);
  const sums = await getLineSums([share.id]);
  const rest = lineRemaining(monthly, sums.get(lineKey(share.id, v.month)));
  if (v.amount - rest > 0.005) {
    return { error: `Solo restan $${rest.toLocaleString("es-MX", { maximumFractionDigits: 2 })}` };
  }

  const accountId = v.accountId || null;
  if (accountId) {
    const mine = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!mine) return { error: "Cuenta no encontrada" };
  }

  // — Recibe (acreedor registra "me pagó"): confirmado + ingreso inmediato —
  if (userId === creditorId) {
    if (!accountId) return { error: "Elige la cuenta donde recibiste" };
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) return { error: "Cuenta no encontrada" };
    const catError = await checkCategory(userId, "TRANSFERENCIA", "INCOME");
    if (catError) return { error: catError };
    const debtor = await prisma.user.findUnique({ where: { id: debtorId }, select: { name: true } });

    const income = await prisma.transaction.create({
      data: {
        type: "INCOME",
        amount: v.amount,
        concept: `Pago de ${debtor?.name ?? "pareja"} · ${tx.concept}`,
        category: "TRANSFERENCIA",
        date: new Date(),
        accountId,
        createdById: userId,
        installments: 1,
        isShared: false,
      },
    });
    await prisma.account.update({
      where: { id: accountId },
      data: account.type === "CREDIT" ? { balance: { decrement: v.amount } } : { balance: { increment: v.amount } },
    });
    await prisma.debtPayment.create({
      data: {
        shareId: share.id,
        month: v.month,
        amount: v.amount,
        status: "CONFIRMED",
        registeredById: userId,
        confirmedById: userId,
        accountId,
        transactionId: income.id,
      },
    });
    revalidateDebts();
    return { ok: true };
  }

  // — Paga (deudor registra "le pagué"): pendiente + egreso opcional propio —
  let expenseId: string | null = null;
  if (accountId) {
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) return { error: "Cuenta no encontrada" };
    const catError = await checkCategory(userId, "OTRO", "EXPENSE");
    if (catError) return { error: catError };
    const expense = await prisma.transaction.create({
      data: {
        type: "EXPENSE",
        amount: v.amount,
        concept: `Pago a ${tx.createdBy.name} · ${tx.concept}`,
        category: "OTRO",
        date: new Date(),
        accountId,
        createdById: userId,
        installments: 1,
        isShared: false,
      },
    });
    await prisma.account.update({
      where: { id: accountId },
      data: account.type === "CREDIT" ? { balance: { increment: v.amount } } : { balance: { decrement: v.amount } },
    });
    expenseId = expense.id;
  }
  await prisma.debtPayment.create({
    data: {
      shareId: share.id,
      month: v.month,
      amount: v.amount,
      status: "PENDING",
      registeredById: userId,
      accountId,
      transactionId: expenseId,
    },
  });
  revalidateDebts();
  return { ok: true };
}

const ConfirmSchema = z.object({
  paymentId: z.string().min(1),
  accountId: z.string().min(1, "Elige la cuenta donde recibiste"),
});

/**
 * El acreedor confirma un pago registrado por el deudor.
 * Crea el ingreso en SU propia cuenta (la elige al confirmar).
 */
export async function confirmPayment(formData: FormData) {
  const userId = await meId();
  if (!userId) return { error: "No autenticado" };
  const dbErr = noDb();
  if (dbErr) return dbErr;

  const parsed = ConfirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  const account = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!account) return { error: "Cuenta no encontrada" };

  try {
    await prisma.$transaction(async (db) => {
      const p = await db.debtPayment.findUnique({
        where: { id: v.paymentId },
        include: { share: { include: { transaction: { include: { createdBy: true } } } } },
      });
      if (!p) throw new Error("Pago no encontrado");
      if (p.status !== "PENDING") throw new Error("Este pago ya fue atendido");
      const creditorId = p.share.transaction.createdById;
      if (userId !== creditorId) throw new Error("Solo quien recibe puede confirmar");
      if (p.registeredById === userId) throw new Error("No puedes confirmar tu propio registro");

      const monthly = Number(p.share.monthlyAmount);
      const rows = await db.debtPayment.findMany({
        where: { shareId: p.shareId, month: p.month, status: "CONFIRMED" },
        select: { amount: true },
      });
      const confirmed = rows.reduce((a, r) => a + Number(r.amount), 0);
      if (Number(p.amount) - Math.max(0, monthly - confirmed) > 0.005) {
        throw new Error("El monto excede lo restante de la parcialidad");
      }

      const debtor = await db.user.findUnique({ where: { id: p.share.debtorId }, select: { name: true } });
      const income = await db.transaction.create({
        data: {
          type: "INCOME",
          amount: p.amount,
          concept: `Pago de ${debtor?.name ?? "pareja"} · ${p.share.transaction.concept}`,
          category: "TRANSFERENCIA",
          date: new Date(),
          accountId: v.accountId,
          createdById: userId,
          installments: 1,
          isShared: false,
        },
      });
      await db.account.update({
        where: { id: v.accountId },
        data: account.type === "CREDIT" ? { balance: { decrement: p.amount } } : { balance: { increment: p.amount } },
      });
      await db.debtPayment.update({
        where: { id: p.id },
        data: { status: "CONFIRMED", confirmedById: userId, accountId: v.accountId, transactionId: income.id },
      });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo confirmar" };
  }
  revalidateDebts();
  return { ok: true };
}

/** La contraparte (acreedor) rechaza un pago pendiente del deudor. */
export async function rejectPayment(paymentId: string) {
  const userId = await meId();
  if (!userId) return { error: "No autenticado" };
  const dbErr = noDb();
  if (dbErr) return dbErr;

  const p = await prisma.debtPayment.findUnique({
    where: { id: paymentId },
    include: { share: { include: { transaction: true } } },
  });
  if (!p) return { error: "Pago no encontrado" };
  if (p.status !== "PENDING") return { error: "Este pago ya fue atendido" };
  if (userId !== p.share.transaction.createdById || userId === p.registeredById) {
    return { error: "Solo quien recibe puede rechazar" };
  }
  await prisma.debtPayment.update({ where: { id: p.id }, data: { status: "REJECTED" } });
  revalidateDebts();
  return { ok: true };
}

/** El registrante cancela su propio pago pendiente. */
export async function cancelPayment(paymentId: string) {
  const userId = await meId();
  if (!userId) return { error: "No autenticado" };
  const dbErr = noDb();
  if (dbErr) return dbErr;

  const p = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
  if (!p) return { error: "Pago no encontrado" };
  if (p.registeredById !== userId) return { error: "Solo quien registró puede cancelar" };
  if (p.status !== "PENDING") return { error: "Solo se puede cancelar un pago pendiente" };
  await prisma.debtPayment.delete({ where: { id: p.id } });
  revalidateDebts();
  return { ok: true };
}

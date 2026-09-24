"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { debtorMonthlyAmount } from "@/lib/calculations";
import { checkCategory } from "@/lib/catalog";
import { getLineSums, lineKey } from "@/lib/debt-payments";

const AccountSchema = z.object({
  name: z.string().min(2, "Nombre muy corto"),
  type: z.enum(["DEBIT", "CREDIT"]),
  lastFour: z.string().optional(),
  expiry: z.string().optional(),
  color: z.string().optional(),
  initialBalance: z.coerce.number().min(0).default(0),
  creditLimit: z.coerce.number().min(0).optional(),
  statementDay: z.coerce.number().min(1).max(31).optional(),
  dueDay: z.coerce.number().min(1).max(31).optional(),
});

const EXPIRY_RE = /^(0[1-9]|1[0-2])\/\d{2}$/;

function normalizeExpiry(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v === "" ? null : v;
}

export async function createAccount(formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para guardar cuentas" };

  const parsed = AccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  if (v.type === "CREDIT" && !v.creditLimit) return { error: "La tarjeta necesita límite de crédito" };
  const expiry = normalizeExpiry(v.expiry);
  if (expiry && !EXPIRY_RE.test(expiry)) return { error: "Vencimiento inválido, usa MM/AA" };

  await prisma.account.create({
    data: {
      name: v.name,
      type: v.type,
      userId,
      lastFour: v.lastFour || null,
      expiry,
      color: v.color || "#6366f1",
      initialBalance: v.type === "DEBIT" ? v.initialBalance : null,
      creditLimit: v.type === "CREDIT" ? v.creditLimit ?? null : null,
      statementDay: v.type === "CREDIT" ? v.statementDay ?? null : null,
      dueDay: v.type === "CREDIT" ? v.dueDay ?? null : null,
    },
  });

  revalidatePath("/cuentas");
  return { ok: true };
}

const UpdateAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "Nombre muy corto"),
  lastFour: z.string().optional(),
  expiry: z.string().optional(),
  color: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  statementDay: z.coerce.number().min(1).max(31).optional(),
  dueDay: z.coerce.number().min(1).max(31).optional(),
});

// Edición solo del dueño. No se toca type ni initialBalance
// (el saldo se deriva de los movimientos, lib/balances.ts).
export async function updateAccount(formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para guardar cambios" };

  const parsed = UpdateAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  const expiry = normalizeExpiry(v.expiry);
  if (expiry && !EXPIRY_RE.test(expiry)) return { error: "Vencimiento inválido, usa MM/AA" };

  const acc = await prisma.account.findFirst({
    where: { id: v.id, userId },
    select: { id: true, type: true, color: true, creditLimit: true },
  });
  if (!acc) return { error: "Cuenta no encontrada" };

  await prisma.account.update({
    where: { id: v.id },
    data: {
      name: v.name,
      lastFour: v.lastFour?.trim() ? v.lastFour.trim() : null,
      expiry,
      color: v.color || acc.color,
      ...(acc.type === "CREDIT"
        ? {
            creditLimit: v.creditLimit ?? acc.creditLimit,
            statementDay: v.statementDay ?? null,
            dueDay: v.dueDay ?? null,
          }
        : {}),
    },
  });

  revalidatePath("/cuentas");
  return { ok: true };
}

// Eliminado suave: oculta la cuenta pero conserva el historial de movimientos.
// Solo el dueño puede eliminarla.
export async function deleteAccount(id: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para eliminar cuentas" };

  const acc = await prisma.account.findFirst({ where: { id, userId }, select: { id: true } });
  if (!acc) return { error: "Cuenta no encontrada" };

  await prisma.account.update({ where: { id }, data: { isActive: false } });

  revalidatePath("/cuentas");
  return { ok: true };
}

const UpdateTxSchema = z.object({
  id: z.string().min(1),
  amount: z.coerce.number().positive("Monto debe ser mayor a 0"),
  concept: z.string().min(2, "Agrega un concepto"),
  category: z.string().default("OTRO"),
  date: z.string(),
  accountId: z.string().min(1, "Elige una cuenta"),
  transferToAccountId: z.string().optional(),
});

// Edición solo del creador. Editables: concepto, monto, categoría, fecha y
// cuenta. Tipo, MSI y compartido quedan fijos (definen las parcialidades).
export async function updateTransaction(formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para guardar cambios" };

  const parsed = UpdateTxSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  const tx = await prisma.transaction.findFirst({
    where: { id: v.id, createdById: userId },
    include: { account: true, shares: true },
  });
  if (!tx) return { error: "Movimiento no encontrado" };

  // Pagos de pareja ligados: CONFIRMED bloquea (historia acordada);
  // PENDING se sincroniza al nuevo monto (validado contra el restante).
  const linkedPayments = await prisma.debtPayment.findMany({
    where: { OR: [{ transactionId: v.id }, { debtorTransactionId: v.id }] },
    select: { id: true, status: true, shareId: true, month: true, amount: true },
  });
  if (linkedPayments.some((p) => p.status === "CONFIRMED")) {
    return { error: "Este movimiento ya fue confirmado en Pareja" };
  }
  const pendingLinks = linkedPayments.filter((p) => p.status === "PENDING");
  for (const p of pendingLinks) {
    const share = await prisma.transactionShare.findUnique({
      where: { id: p.shareId },
      select: { monthlyAmount: true },
    });
    if (!share) return { error: "Aportación no encontrada" };
    const sums = await getLineSums([p.shareId]);
    const confirmed = sums.get(lineKey(p.shareId, p.month))?.confirmed ?? 0;
    const rest = Math.max(0, Number(share.monthlyAmount) - confirmed) + Number(p.amount);
    if (v.amount - rest > 0.005) {
      return { error: `Solo restan $${rest.toLocaleString("es-MX", { maximumFractionDigits: 2 })} en esa parcialidad` };
    }
  }

  const catError = await checkCategory(userId, v.category, tx.type as "EXPENSE" | "INCOME" | "TRANSFER");
  if (catError) return { error: catError };

  const newAcc = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!newAcc) return { error: "Cuenta no encontrada" };

  // Traspaso: solo se reescribe la fila (el saldo se deriva por suma).
  if (tx.type === "TRANSFER") {
    const newDestId = v.transferToAccountId;
    if (!newDestId || newDestId === v.accountId) return { error: "Elige una cuenta destino distinta" };
    const newDest = await prisma.account.findFirst({ where: { id: newDestId, userId } });
    if (!newDest) return { error: "Cuenta destino no encontrada" };
    if (newAcc.type !== "DEBIT") return { error: "El traspaso debe salir de una cuenta de débito" };
    if (!tx.transferToAccountId) return { error: "Este movimiento no tiene destino registrado" };

    await prisma.transaction.update({
      where: { id: v.id },
      data: {
        amount: v.amount,
        concept: v.concept,
        date: new Date(v.date),
        accountId: v.accountId,
        transferToAccountId: newDestId,
      },
    });

    revalidatePath("/actividad");
    revalidatePath("/resumen");
    revalidatePath("/cuentas");
    return { ok: true };
  }

  await prisma.transaction.update({
    where: { id: v.id },
    data: {
      amount: v.amount,
      concept: v.concept,
      category: v.category,
      date: new Date(v.date),
      accountId: v.accountId,
    },
  });

  // Sincroniza los reclamos pendientes al nuevo monto.
  for (const p of pendingLinks) {
    await prisma.debtPayment.update({ where: { id: p.id }, data: { amount: v.amount } });
  }

  // Si era compartido, recalcula la cuota mensual con el nuevo monto
  // (mismo porcentaje y parcialidades). Los montos fijos pactados no se tocan.
  for (const s of tx.shares) {
    if (s.isFixedAmount) continue;
    await prisma.transactionShare.update({
      where: { id: s.id },
      data: { monthlyAmount: debtorMonthlyAmount(v.amount, tx.installments, s.sharePct) },
    });
  }

  revalidatePath("/actividad");
  revalidatePath("/resumen");
  revalidatePath("/cuentas");
  return { ok: true };
}

// Borrado físico. El saldo se deriva por suma, así que basta borrar la fila.
// Solo el creador. Si el movimiento es parte de un pago de pareja:
// - PENDING (la contraparte aún no confirma) → se puede borrar; el reclamo
//   pendiente se elimina con él.
// - CONFIRMED (ya confirmado) → bloqueado, primero cancélalo en Pareja.
// Los cargos de suscripción siguen bloqueados (tienen su propio flujo).
export async function deleteTransaction(id: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para eliminar movimientos" };

  const tx = await prisma.transaction.findFirst({
    where: { id, createdById: userId },
    include: {
      account: true,
      debtPayment: true,
      debtorSourcePayment: true,
      charges: { select: { id: true } },
    },
  });
  if (!tx) return { error: "Movimiento no encontrado" };

  const linkedPayments = [tx.debtPayment, tx.debtorSourcePayment].filter((p) => p != null);
  if (linkedPayments.some((p) => p.status === "CONFIRMED")) {
    return { error: "Este pago ya fue confirmado por tu pareja: cancélalo en Pareja" };
  }
  if (linkedPayments.length > 0) {
    // Reclamos aún no confirmados: mueren con el movimiento.
    await prisma.debtPayment.deleteMany({ where: { id: { in: linkedPayments.map((p) => p.id) } } });
  }
  if (tx.charges.length > 0) {
    return { error: "Este movimiento es un cargo de suscripción confirmado" };
  }
  if (tx.subscriptionId) {
    return { error: "Este movimiento es un cargo de suscripción confirmado" };
  }

  await prisma.transaction.delete({ where: { id } });

  revalidatePath("/actividad");
  revalidatePath("/resumen");
  revalidatePath("/cuentas");
  return { ok: true };
}

const TxSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).default("EXPENSE"),
  amount: z.coerce.number().positive("Monto debe ser mayor a 0"),
  concept: z.string().min(2, "Agrega un concepto"),
  category: z.string().default("OTRO"),
  date: z.string().default(() => new Date().toISOString()),
  accountId: z.string().min(1, "Elige una cuenta"),
  transferToAccountId: z.string().optional(),
  installments: z.coerce.number().min(1).max(24).default(1),
  isShared: z.coerce.boolean().default(false),
  sharePct: z.coerce.number().min(1).max(99).default(50),
  shareAmount: z.coerce.number().positive().optional(),
  debtorId: z.string().optional(),
});

export async function createTransaction(formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para guardar movimientos" };

  const raw = Object.fromEntries(formData);
  const parsed = TxSchema.safeParse({ ...raw, isShared: raw.isShared === "on" || raw.isShared === "true" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  const catError = await checkCategory(userId, v.category, v.type as "EXPENSE" | "INCOME" | "TRANSFER");
  if (catError) return { error: catError };

  // Solo cuentas propias: nadie opera ni ve cuentas de su pareja.
  const account = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!account) return { error: "Cuenta no encontrada" };

  // Traspaso entre cuentas propias: sale de un débito y llega a débito o crédito.
  if (v.type === "TRANSFER") {
    const destId = v.transferToAccountId;
    if (!destId || destId === v.accountId) return { error: "Elige una cuenta destino distinta" };
    const dest = await prisma.account.findFirst({ where: { id: destId, userId } });
    if (!dest) return { error: "Cuenta destino no encontrada" };
    if (account.type !== "DEBIT") return { error: "El traspaso debe salir de una cuenta de débito" };

    await prisma.transaction.create({
      data: {
        type: "TRANSFER",
        amount: v.amount,
        concept: v.concept,
        category: v.category,
        date: new Date(v.date),
        accountId: v.accountId,
        transferToAccountId: destId,
        createdById: userId,
        installments: 1,
        isShared: false,
      },
    });

    revalidatePath("/actividad");
    revalidatePath("/resumen");
    revalidatePath("/cuentas");
    return { ok: true };
  }

  // Determina al deudor: el otro miembro de la pareja.
  let debtorId: string | null = null;
  if (v.isShared) {
    if (v.debtorId) {
      debtorId = v.debtorId;
    } else {
      const other = await prisma.user.findFirst({ where: { id: { not: userId } } });
      debtorId = other?.id ?? null;
    }
    if (!debtorId || debtorId === userId) return { error: "No se pudo determinar quién debe aportar" };
  }

  if (v.type === "EXPENSE" && v.isShared && v.shareAmount && v.shareAmount >= v.amount) {
    return { error: "La aportación debe ser menor al total" };
  }

  // El saldo se deriva por suma (lib/balances.ts): solo se crean filas.
  // Movimiento + share en una transacción para no dejar mitades.
  await prisma.$transaction(async (db) => {
    const tx = await db.transaction.create({
      data: {
        type: v.type as "EXPENSE" | "INCOME" | "TRANSFER",
        amount: v.amount,
        concept: v.concept,
        category: v.category,
        date: new Date(v.date),
        accountId: v.accountId,
        createdById: userId,
        installments: v.type === "EXPENSE" ? Math.round(v.installments) : 1,
        isShared: v.type === "EXPENSE" && v.isShared,
      },
    });

    if (v.type === "EXPENSE" && v.isShared && debtorId) {
      // Cantidad fija pactada (ej. $125 de $400) o porcentaje (50/50 por defecto).
      const n = Math.max(1, Math.round(v.installments));
      await db.transactionShare.create({
        data: {
          transactionId: tx.id,
          debtorId,
          sharePct: v.shareAmount ? (v.shareAmount / v.amount) * 100 : v.sharePct,
          monthlyAmount: v.shareAmount ? v.shareAmount / n : debtorMonthlyAmount(v.amount, v.installments, v.sharePct),
          isFixedAmount: Boolean(v.shareAmount),
        },
      });
    }
  });

  revalidatePath("/actividad");
  revalidatePath("/resumen");
  revalidatePath("/cuentas");
  return { ok: true };
}

export async function loginAction(formData: FormData) {
  // Credenciales malas con redirect:false llegan como excepción CredentialsSignin.
  const { CredentialsSignin } = await import("next-auth");
  const { signIn } = await import("@/auth");
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    // redirect:false → no lanza NEXT_REDIRECT; el fallo viene como excepción.
    const res = await signIn("credentials", { username, password, redirect: false });
    if (res?.error) return { error: "Revisa tu usuario y contraseña" };
    return { ok: true };
  } catch (e) {
    if (e instanceof CredentialsSignin) return { error: "Revisa tu usuario y contraseña" };
    return { error: "No se pudo iniciar sesión, intenta de nuevo" };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { debtorMonthlyAmount } from "@/lib/calculations";
import { checkCategory } from "@/lib/catalog";

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
      balance: v.type === "DEBIT" ? v.initialBalance : 0,
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

// Edición solo del dueño. No se toca type, initialBalance ni balance
// (el saldo se mueve únicamente con movimientos).
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

// Mueve el saldo en la dirección indicada. dir=1 aplica el efecto,
// dir=-1 lo revierte. Réplica exacta de la lógica de createTransaction.
export async function moveBalance(accountId: string, accType: string, txType: string, amount: number, dir: 1 | -1) {
  if (txType === "EXPENSE" && accType === "CREDIT") {
    await prisma.account.update({
      where: { id: accountId },
      data: dir === 1 ? { balance: { increment: amount } } : { balance: { decrement: amount } },
    });
  } else if (txType === "EXPENSE" && accType === "DEBIT") {
    await prisma.account.update({
      where: { id: accountId },
      data: dir === 1 ? { balance: { decrement: amount } } : { balance: { increment: amount } },
    });
  } else if (txType === "INCOME" && accType === "DEBIT") {
    await prisma.account.update({
      where: { id: accountId },
      data: dir === 1 ? { balance: { increment: amount } } : { balance: { decrement: amount } },
    });
  } else if (txType === "INCOME" && accType === "CREDIT") {
    // Abono a tarjeta: reduce la deuda (libera línea); revertir la regresa.
    await prisma.account.update({
      where: { id: accountId },
      data: dir === 1 ? { balance: { decrement: amount } } : { balance: { increment: amount } },
    });
  }
}

// Traspaso entre cuentas propias. dir=1 aplica, dir=-1 revierte.
// Destino débito: suma saldo · destino crédito: reduce deuda (libera línea).
async function moveTransfer(
  origin: { id: string; type: string },
  dest: { id: string; type: string },
  amount: number,
  dir: 1 | -1,
) {
  const out = dir === 1;
  await prisma.account.update({
    where: { id: origin.id },
    data: out ? { balance: { decrement: amount } } : { balance: { increment: amount } },
  });
  await prisma.account.update({
    where: { id: dest.id },
    data:
      dest.type === "CREDIT"
        ? out
          ? { balance: { decrement: amount } }
          : { balance: { increment: amount } }
        : out
          ? { balance: { increment: amount } }
          : { balance: { decrement: amount } },
  });
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

  const catError = await checkCategory(userId, v.category, tx.type as "EXPENSE" | "INCOME" | "TRANSFER");
  if (catError) return { error: catError };

  const newAcc = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!newAcc) return { error: "Cuenta no encontrada" };

  // Traspaso: revierte origen/destino anteriores y aplica los nuevos.
  if (tx.type === "TRANSFER") {
    const newDestId = v.transferToAccountId;
    if (!newDestId || newDestId === v.accountId) return { error: "Elige una cuenta destino distinta" };
    const newDest = await prisma.account.findFirst({ where: { id: newDestId, userId } });
    if (!newDest) return { error: "Cuenta destino no encontrada" };
    if (newAcc.type !== "DEBIT") return { error: "El traspaso debe salir de una cuenta de débito" };
    if (!tx.transferToAccountId) return { error: "Este movimiento no tiene destino registrado" };
    const oldDest = await prisma.account.findFirst({
      where: { id: tx.transferToAccountId, userId },
      select: { id: true, type: true },
    });

    await moveTransfer(
      { id: tx.accountId, type: tx.account.type },
      { id: tx.transferToAccountId, type: oldDest?.type ?? "CREDIT" },
      Number(tx.amount),
      -1,
    );
    await moveTransfer(
      { id: v.accountId, type: newAcc.type },
      { id: newDestId, type: newDest.type },
      v.amount,
      1,
    );
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

  // Revierte el efecto anterior y aplica el nuevo (puede cambiar de cuenta).
  await moveBalance(tx.accountId, tx.account.type, tx.type, Number(tx.amount), -1);
  await moveBalance(v.accountId, newAcc.type, tx.type, v.amount, 1);

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

// Borrado físico con reversión del saldo. Solo el creador. Los shares
// compartidos se eliminan en cascada.
export async function deleteTransaction(id: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para eliminar movimientos" };

  const tx = await prisma.transaction.findFirst({
    where: { id, createdById: userId },
    include: { account: true },
  });
  if (!tx) return { error: "Movimiento no encontrado" };

  if (tx.type === "TRANSFER") {
    if (!tx.transferToAccountId) return { error: "Este movimiento no tiene destino registrado" };
    const dest = await prisma.account.findFirst({
      where: { id: tx.transferToAccountId, userId },
      select: { id: true, type: true },
    });
    await moveTransfer(
      { id: tx.accountId, type: tx.account.type },
      { id: tx.transferToAccountId, type: dest?.type ?? "CREDIT" },
      Number(tx.amount),
      -1,
    );
  } else {
    await moveBalance(tx.accountId, tx.account.type, tx.type, Number(tx.amount), -1);
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
    await moveTransfer({ id: v.accountId, type: account.type }, { id: destId, type: dest.type }, v.amount, 1);

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

  const tx = await prisma.transaction.create({
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
    await prisma.transactionShare.create({
      data: {
        transactionId: tx.id,
        debtorId,
        sharePct: v.shareAmount ? (v.shareAmount / v.amount) * 100 : v.sharePct,
        monthlyAmount: v.shareAmount ? v.shareAmount / n : debtorMonthlyAmount(v.amount, v.installments, v.sharePct),
        isFixedAmount: Boolean(v.shareAmount),
      },
    });
  }

  // Actualiza saldo / deuda
  if (v.type === "EXPENSE") {
    await prisma.account.update({
      where: { id: v.accountId },
      data: account.type === "CREDIT"
        ? { balance: { increment: v.amount } }
        : { balance: { decrement: v.amount } },
    });
  } else if (v.type === "INCOME") {
    // Abono: en débito suma saldo; en crédito reduce deuda (libera línea).
    await prisma.account.update({
      where: { id: v.accountId },
      data: account.type === "CREDIT"
        ? { balance: { decrement: v.amount } }
        : { balance: { increment: v.amount } },
    });
  }

  revalidatePath("/actividad");
  revalidatePath("/resumen");
  revalidatePath("/cuentas");
  return { ok: true };
}

export async function loginAction(formData: FormData) {
  const { signIn } = await import("@/auth");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/actividad" });
  } catch (e) {
    // NextAuth lanza NEXT_REDIRECT en éxito — se propaga solo.
    throw e;
  }
}

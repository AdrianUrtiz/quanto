"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { debtorMonthlyAmount } from "@/lib/calculations";

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

const TxSchema = z.object({
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER"]).default("EXPENSE"),
  amount: z.coerce.number().positive("Monto debe ser mayor a 0"),
  concept: z.string().min(2, "Agrega un concepto"),
  category: z.string().default("OTRO"),
  date: z.string().default(() => new Date().toISOString()),
  accountId: z.string().min(1, "Elige una cuenta"),
  installments: z.coerce.number().min(1).max(24).default(1),
  isShared: z.coerce.boolean().default(false),
  sharePct: z.coerce.number().min(1).max(100).default(50),
  debtorId: z.string().optional(),
});

const CATEGORIES = ["COMIDA","TRANSPORTE","VIVIENDA","SERVICIOS","SALUD","OCIO","COMPRAS","EDUCACION","VIAJES","MASCOTAS","SUSCRIPCIONES","NOMINA","OTRO"] as const;

export async function createTransaction(formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para guardar movimientos" };

  const raw = Object.fromEntries(formData);
  const parsed = TxSchema.safeParse({ ...raw, isShared: raw.isShared === "on" || raw.isShared === "true" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  if (!CATEGORIES.includes(v.category as (typeof CATEGORIES)[number])) return { error: "Categoría inválida" };

  // Solo cuentas propias: nadie opera ni ve cuentas de su pareja.
  const account = await prisma.account.findFirst({ where: { id: v.accountId, userId } });
  if (!account) return { error: "Cuenta no encontrada" };

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

  const tx = await prisma.transaction.create({
    data: {
      type: v.type as "EXPENSE" | "INCOME" | "TRANSFER",
      amount: v.amount,
      concept: v.concept,
      category: v.category as (typeof CATEGORIES)[number],
      date: new Date(v.date),
      accountId: v.accountId,
      createdById: userId,
      installments: v.type === "EXPENSE" ? Math.round(v.installments) : 1,
      isShared: v.type === "EXPENSE" && v.isShared,
    },
  });

  if (v.type === "EXPENSE" && v.isShared && debtorId) {
    await prisma.transactionShare.create({
      data: {
        transactionId: tx.id,
        debtorId,
        sharePct: v.sharePct,
        monthlyAmount: debtorMonthlyAmount(v.amount, v.installments, v.sharePct),
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
  } else if (v.type === "INCOME" && account.type === "DEBIT") {
    await prisma.account.update({ where: { id: v.accountId }, data: { balance: { increment: v.amount } } });
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

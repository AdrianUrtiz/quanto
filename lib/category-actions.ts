"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ICONS, CATEGORY_COLORS } from "@/lib/categories";

function authedUser(session: Session | null) {
  return (session?.user as { id?: string } | undefined)?.id;
}

function revalidateAll() {
  revalidatePath("/actividad");
  revalidatePath("/resumen");
  revalidatePath("/cuentas");
  revalidatePath("/categorias");
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const CatSchema = z.object({
  name: z.string().min(2, "Nombre muy corto").max(30, "Máximo 30 letras"),
  iconName: z.string().min(1, "Elige un icono"),
  color: z.string().regex(HEX_RE, "Color inválido"),
  kind: z.enum(["expense", "income", "both"]),
});

function genCode() {
  return `c${randomUUID().replace(/-/g, "").slice(0, 11)}`;
}

export async function createCategory(formData: FormData) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const parsed = CatSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  if (!ICONS[v.iconName]) return { error: "Icono inválido" };
  if (!CATEGORY_COLORS.includes(v.color) && !HEX_RE.test(v.color)) {
    return { error: "Color inválido" };
  }

  // Código único por usuario (reintenta ante colisión).
  let code = genCode();
  for (let i = 0; i < 3; i++) {
    const clash = await prisma.category.findFirst({ where: { userId, code } });
    if (!clash) break;
    code = genCode();
  }

  const row = await prisma.category.create({
    data: {
      code,
      name: v.name.trim(),
      iconName: v.iconName,
      color: v.color,
      kind: v.kind,
      userId,
      isDefault: false,
    },
  });

  revalidateAll();
  return {
    ok: true as const,
    category: {
      id: row.id,
      code: row.code,
      name: row.name,
      iconName: row.iconName,
      color: row.color,
      kind: row.kind,
    },
  };
}

export async function updateCategory(formData: FormData) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const parsed = CatSchema.extend({ id: z.string().min(1) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;
  if (!ICONS[v.iconName]) return { error: "Icono inválido" };

  // Editable: propia o global por defecto (aplica a ambos miembros).
  const row = await prisma.category.findFirst({
    where: { id: v.id, OR: [{ userId }, { userId: null }] },
  });
  if (!row) return { error: "Categoría no encontrada" };

  await prisma.category.update({
    where: { id: v.id },
    data: { name: v.name.trim(), iconName: v.iconName, color: v.color, kind: v.kind },
  });

  revalidateAll();
  return { ok: true as const };
}

export async function deleteCategory(id: string) {
  const userId = authedUser(await auth());
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL" };

  const row = await prisma.category.findFirst({ where: { id, userId } });
  if (!row) return { error: "Categoría no encontrada" };
  if (row.isDefault || !row.userId) return { error: "Las categorías del sistema no se pueden eliminar" };

  const used = await prisma.transaction.count({ where: { createdById: userId, category: row.code } });
  if (used > 0) {
    return { error: `Tiene ${used} movimiento${used === 1 ? "" : "s"}; no se puede eliminar` };
  }
  const usedSubs = await prisma.subscription.count({ where: { userId, category: row.code } });
  if (usedSubs > 0) {
    return { error: `Está en ${usedSubs} suscripcion${usedSubs === 1 ? "" : "es"}; no se puede eliminar` };
  }

  await prisma.category.delete({ where: { id } });
  revalidateAll();
  return { ok: true as const };
}

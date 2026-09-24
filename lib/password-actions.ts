"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const PasswordSchema = z
  .object({
    current: z.string().min(1, "Ingresa tu contraseña actual"),
    next: z
      .string()
      .min(8, "Mínimo 8 caracteres")
      .regex(/\d/, "Debe incluir al menos un número"),
    confirm: z.string().min(1, "Confirma tu contraseña nueva"),
  })
  .refine((v) => v.next === v.confirm, {
    message: "Las contraseñas nuevas no coinciden",
    path: ["confirm"],
  })
  .refine((v) => v.next !== v.current, {
    message: "La nueva debe ser distinta a la actual",
    path: ["next"],
  });

/** Cambia la contraseña del usuario en sesión. */
export async function changePassword(formData: FormData) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: "No autenticado" };
  if (!process.env.DATABASE_URL) return { error: "Configura DATABASE_URL para cambiar tu contraseña" };

  const parsed = PasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  const v = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, password: true } });
  if (!user) return { error: "Usuario no encontrado" };
  const ok = await bcrypt.compare(v.current, user.password);
  if (!ok) return { error: "Tu contraseña actual no es correcta" };

  await prisma.user.update({
    where: { id: userId },
    data: { password: await bcrypt.hash(v.next, 10) },
  });
  return { ok: true };
}

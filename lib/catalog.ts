import { prisma } from "@/lib/prisma";
import { DEFAULT_CATS, parseCat, type CatKind } from "@/lib/categories";

// Fila del catálogo visible para un usuario: globales + propias.
export type CatalogRow = {
  id: string;
  code: string;
  name: string;
  iconName: string;
  color: string;
  kind: CatKind;
  isDefault: boolean;
  mine: boolean;
};

export async function getCatalog(userId: string): Promise<CatalogRow[]> {
  try {
    const rows = await prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      orderBy: { createdAt: "asc" },
    });
    if (!rows.length) throw new Error("empty");
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      iconName: r.iconName,
      color: r.color,
      kind: (r.kind === "income" || r.kind === "both" ? r.kind : "expense") as CatKind,
      isDefault: r.isDefault,
      mine: r.userId === userId,
    }));
  } catch {
    // Tabla vacía: catálogo quemado como respaldo.
    return DEFAULT_CATS.map((c) => ({
      id: c.code,
      code: c.code,
      name: c.label,
      iconName: c.iconName,
      color: c.color,
      kind: c.kind,
      isDefault: true,
      mine: false,
    }));
  }
}

/** Busca un código en globales + propias. Null si no existe. */
export async function findCategory(
  userId: string,
  code: string,
): Promise<CatalogRow | null> {
  try {
    const r = await prisma.category.findFirst({
      where: { code, OR: [{ userId: null }, { userId }] },
    });
    if (!r) return null;
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      iconName: r.iconName,
      color: r.color,
      kind: (r.kind === "income" || r.kind === "both" ? r.kind : "expense") as CatKind,
      isDefault: r.isDefault,
      mine: r.userId === userId,
    };
  } catch {
    const d = DEFAULT_CATS.find((c) => c.code === code);
    if (!d) return null;
    return {
      id: d.code,
      code: d.code,
      name: d.label,
      iconName: d.iconName,
      color: d.color,
      kind: d.kind,
      isDefault: true,
      mine: false,
    };
  }
}

/** Valida categoría contra catálogo (+ legados custom:...). Null = válida. */
export async function checkCategory(
  userId: string,
  code: string,
  txType: "EXPENSE" | "INCOME" | "TRANSFER",
): Promise<string | null> {
  if (txType === "TRANSFER") return null;
  const row = await findCategory(userId, code);
  const kind = row?.kind ?? (code.startsWith("custom:") ? parseCat(code).kind : null);
  if (!kind) return "Categoría inválida";
  if (txType === "EXPENSE" && kind === "income") return "Esa categoría es de ingresos";
  if (txType === "INCOME" && kind === "expense") return "Esa categoría es de gastos";
  return null;
}

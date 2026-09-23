// Catálogo de categorías + soporte a personalizadas ("Add new").
// Las personalizadas se guardan como código `custom:{emoji}:{NOMBRE}` en
// Transaction.category (String), así viajan con el movimiento sin tabla extra.

export type CatKind = "expense" | "income" | "both";
export type CatInfo = { code: string; emoji: string; label: string; custom: boolean; kind: CatKind };
export type CustomCat = { code: string; emoji: string; label: string; kind: CatKind };

type Def = { code: string; emoji: string; label: string; kind: CatKind };

export const DEFAULT_CATS: Def[] = [
  { code: "COMIDA", emoji: "🍔", label: "Comida", kind: "expense" },
  { code: "TRANSPORTE", emoji: "🚗", label: "Transporte", kind: "expense" },
  { code: "VIVIENDA", emoji: "🏠", label: "Vivienda", kind: "expense" },
  { code: "SERVICIOS", emoji: "💡", label: "Servicios", kind: "expense" },
  { code: "SALUD", emoji: "💊", label: "Salud", kind: "expense" },
  { code: "OCIO", emoji: "🎬", label: "Ocio", kind: "expense" },
  { code: "COMPRAS", emoji: "🛍️", label: "Compras", kind: "expense" },
  { code: "EDUCACION", emoji: "📚", label: "Educación", kind: "expense" },
  { code: "VIAJES", emoji: "✈️", label: "Viajes", kind: "expense" },
  { code: "MASCOTAS", emoji: "🐾", label: "Mascotas", kind: "expense" },
  { code: "SUSCRIPCIONES", emoji: "🔁", label: "Suscripciones", kind: "expense" },
  { code: "NOMINA", emoji: "💼", label: "Nómina", kind: "income" },
  { code: "TRANSFERENCIA", emoji: "💸", label: "Transferencia", kind: "income" },
  { code: "OTRO", emoji: "📦", label: "Otro", kind: "both" },
];

export const EMOJI_PRESETS = ["🎮", "☕", "🍔", "🚗", "🏠", "💡", "💊", "🎬", "🐾", "📚", "✈️", "🎁", "🛍️", "💼", "📦", "🔁"];

function cap(s: string) {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function parseCat(code: string): CatInfo {
  if (code.startsWith("custom:")) {
    // Nuevo: custom:{kind}:{emoji}:{NOMBRE} · legado: custom:{emoji}:{NOMBRE} (gasto).
    const parts = code.split(":");
    let kind: CatKind = "expense";
    let emoji = "📦";
    let name: string;
    if (parts[1] === "expense" || parts[1] === "income") {
      kind = parts[1];
      emoji = parts[2] || "📦";
      name = parts.slice(3).join(":").trim() || code;
    } else {
      emoji = parts[1] || "📦";
      name = parts.slice(2).join(":").trim() || code;
    }
    return { code, emoji, label: cap(name), custom: true, kind };
  }
  const d = DEFAULT_CATS.find((c) => c.code === code);
  if (d) return { ...d, custom: false };
  return { code, emoji: "📦", label: cap(code), custom: false, kind: "both" };
}

export function prettyCat(code: string): string {
  return parseCat(code).label;
}

export function makeCustomCat(emoji: string, name: string, kind: "expense" | "income" = "expense"): string {
  const clean = name.trim().toUpperCase().replace(/:/g, "").replace(/\s+/g, " ").slice(0, 30);
  return `custom:${kind}:${emoji}:${clean}`;
}

export function isValidCategory(code: string): boolean {
  if (DEFAULT_CATS.some((c) => c.code === code)) return true;
  if (!code.startsWith("custom:")) return false;
  return parseCat(code).label.length >= 2;
}

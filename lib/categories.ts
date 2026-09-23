// Catálogo de categorías + soporte a personalizadas ("Add new").
// Las personalizadas se guardan como código `custom:{emoji}:{NOMBRE}` en
// Transaction.category (String), así viajan con el movimiento sin tabla extra.

export type CatInfo = { code: string; emoji: string; label: string; custom: boolean };
export type CustomCat = { code: string; emoji: string; label: string };

export const DEFAULT_CATS: { code: string; emoji: string; label: string }[] = [
  { code: "COMIDA", emoji: "🍔", label: "Comida" },
  { code: "TRANSPORTE", emoji: "🚗", label: "Transporte" },
  { code: "VIVIENDA", emoji: "🏠", label: "Vivienda" },
  { code: "SERVICIOS", emoji: "💡", label: "Servicios" },
  { code: "SALUD", emoji: "💊", label: "Salud" },
  { code: "OCIO", emoji: "🎬", label: "Ocio" },
  { code: "COMPRAS", emoji: "🛍️", label: "Compras" },
  { code: "EDUCACION", emoji: "📚", label: "Educación" },
  { code: "VIAJES", emoji: "✈️", label: "Viajes" },
  { code: "MASCOTAS", emoji: "🐾", label: "Mascotas" },
  { code: "SUSCRIPCIONES", emoji: "🔁", label: "Suscripciones" },
  { code: "NOMINA", emoji: "💼", label: "Nómina" },
  { code: "OTRO", emoji: "📦", label: "Otro" },
];

export const EMOJI_PRESETS = ["🎮", "☕", "🍔", "🚗", "🏠", "💡", "💊", "🎬", "🐾", "📚", "✈️", "🎁", "🛍️", "💼", "📦", "🔁"];

function cap(s: string) {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function parseCat(code: string): CatInfo {
  if (code.startsWith("custom:")) {
    const [, emoji = "📦", ...rest] = code.split(":");
    const name = rest.join(":").trim() || code;
    return { code, emoji, label: cap(name), custom: true };
  }
  const d = DEFAULT_CATS.find((c) => c.code === code);
  if (d) return { ...d, custom: false };
  return { code, emoji: "📦", label: cap(code), custom: false };
}

export function prettyCat(code: string): string {
  return parseCat(code).label;
}

export function makeCustomCat(emoji: string, name: string): string {
  const clean = name.trim().toUpperCase().replace(/:/g, "").replace(/\s+/g, " ").slice(0, 30);
  return `custom:${emoji}:${clean}`;
}

export function isValidCategory(code: string): boolean {
  if (DEFAULT_CATS.some((c) => c.code === code)) return true;
  if (!code.startsWith("custom:")) return false;
  return parseCat(code).label.length >= 2;
}

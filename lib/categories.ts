// Catálogo de categorías con iconos Lucide + soporte a personalizadas ("Add new").
// Las personalizadas se guardan como `custom:{kind}:{iconName}:{NOMBRE}` en
// Transaction.category (String). Formato legado `custom:{emoji}:{NOMBRE}` se
// sigue entendiendo (icono genérico).

import {
  Banknote,
  Briefcase,
  Car,
  Clapperboard,
  Coffee,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Lightbulb,
  PawPrint,
  Plane,
  Popcorn,
  Repeat,
  Shapes,
  Shirt,
  ShoppingBag,
  Sparkles,
  Tag,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export type CatKind = "expense" | "income" | "both";
export type CatInfo = {
  code: string;
  icon: LucideIcon;
  iconName: string;
  label: string;
  color: string;
  custom: boolean;
  kind: CatKind;
};
export type CustomCat = { code: string; iconName: string; label: string; color: string; kind: CatKind };

type Def = { code: string; icon: LucideIcon; iconName: string; label: string; color: string; kind: CatKind };

export const DEFAULT_CATS: Def[] = [
  { code: "COMIDA", icon: UtensilsCrossed, iconName: "UtensilsCrossed", label: "Comida", color: "#fb923c", kind: "expense" },
  { code: "TRANSPORTE", icon: Car, iconName: "Car", label: "Transporte", color: "#38bdf8", kind: "expense" },
  { code: "VIVIENDA", icon: House, iconName: "House", label: "Vivienda", color: "#a78bfa", kind: "expense" },
  { code: "SERVICIOS", icon: Lightbulb, iconName: "Lightbulb", label: "Servicios", color: "#facc15", kind: "expense" },
  { code: "SALUD", icon: HeartPulse, iconName: "HeartPulse", label: "Salud", color: "#f87171", kind: "expense" },
  { code: "OCIO", icon: Clapperboard, iconName: "Clapperboard", label: "Ocio", color: "#e879f9", kind: "expense" },
  { code: "COMPRAS", icon: ShoppingBag, iconName: "ShoppingBag", label: "Compras", color: "#ec4899", kind: "expense" },
  { code: "EDUCACION", icon: GraduationCap, iconName: "GraduationCap", label: "Educación", color: "#818cf8", kind: "expense" },
  { code: "VIAJES", icon: Plane, iconName: "Plane", label: "Viajes", color: "#22d3ee", kind: "expense" },
  { code: "MASCOTAS", icon: PawPrint, iconName: "PawPrint", label: "Mascotas", color: "#a3e635", kind: "expense" },
  { code: "SUSCRIPCIONES", icon: Repeat, iconName: "Repeat", label: "Suscripciones", color: "#94a3b8", kind: "expense" },
  { code: "NOMINA", icon: Briefcase, iconName: "Briefcase", label: "Nómina", color: "#34d399", kind: "income" },
  { code: "TRANSFERENCIA", icon: Banknote, iconName: "Banknote", label: "Transferencia", color: "#2dd4bf", kind: "income" },
  { code: "OTRO", icon: Shapes, iconName: "Shapes", label: "Otro", color: "#71717a", kind: "both" },
];

export const ICONS: Record<string, LucideIcon> = {
  ...Object.fromEntries(DEFAULT_CATS.map((c) => [c.iconName, c.icon])),
  Gamepad2,
  Coffee,
  Gift,
  Shirt,
  Popcorn,
  Sparkles,
  Tag,
};

// Iconos elegibles para categorías personalizadas.
export const ICON_PRESETS = [
  "Gamepad2",
  "Clapperboard",
  "PawPrint",
  "GraduationCap",
  "Plane",
  "ShoppingBag",
  "UtensilsCrossed",
  "Car",
  "House",
  "Lightbulb",
  "HeartPulse",
  "Briefcase",
  "Banknote",
  "Repeat",
  "Coffee",
  "Gift",
  "Shirt",
  "Popcorn",
  "Sparkles",
  "Shapes",
  "Tag",
] as const;

function cap(s: string) {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export const DEFAULT_CUSTOM_COLOR = "#71717a";

function fallback(code: string): CatInfo {
  return { code, icon: Shapes, iconName: "Shapes", label: cap(code), color: DEFAULT_CUSTOM_COLOR, custom: false, kind: "both" };
}

export function parseCat(code: string): CatInfo {
  if (code.startsWith("custom:")) {
    const parts = code.split(":");
    // Nuevo: custom:{kind}:{iconName}:{color}:{NOMBRE}
    // Legado: custom:{kind}:{iconName}:{NOMBRE} o custom:{emoji}:{NOMBRE}.
    if (parts[1] === "expense" || parts[1] === "income") {
      const kind = parts[1];
      const iconName = parts[2] || "Shapes";
      let color = DEFAULT_CUSTOM_COLOR;
      let name: string;
      if (parts.length >= 5 && /^[0-9a-fA-F]{6}$/.test(parts[3] || "")) {
        color = `#${parts[3]}`;
        name = parts.slice(4).join(":").trim() || code;
      } else {
        name = parts.slice(3).join(":").trim() || code;
      }
      return { code, icon: ICONS[iconName] ?? Shapes, iconName, label: cap(name), color, custom: true, kind };
    }
    const name = parts.slice(2).join(":").trim() || code;
    return { code, icon: Shapes, iconName: "Shapes", label: cap(name), color: DEFAULT_CUSTOM_COLOR, custom: true, kind: "expense" };
  }
  const d = DEFAULT_CATS.find((c) => c.code === code);
  if (d) return { ...d, custom: false };
  return fallback(code);
}

export function prettyCat(code: string): string {
  return parseCat(code).label;
}

export function makeCustomCat(
  iconName: string,
  name: string,
  kind: "expense" | "income" = "expense",
  color: string = DEFAULT_CUSTOM_COLOR,
): string {
  const clean = name.trim().toUpperCase().replace(/:/g, "").replace(/\s+/g, " ").slice(0, 30);
  const hex = (color.replace("#", "") || "71717a").slice(0, 6);
  return `custom:${kind}:${iconName}:${hex}:${clean}`;
}

// Paleta de cuentas: los 12 originales + 12 nuevos (vivos y oscuros variados).
export const ACCOUNT_COLORS = [
  "#f87171",
  "#fb923c",
  "#facc15",
  "#a3e635",
  "#34d399",
  "#2dd4bf",
  "#22d3ee",
  "#38bdf8",
  "#818cf8",
  "#a78bfa",
  "#e879f9",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#64748b",
  "#78716c",
  "#334155",
  "#0f172a",
  "#1c1917",
  "#000000",
];

// Paleta de categorías: vibrantes + pasteles (sin oscuros).
export const CATEGORY_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#fb7185",
  "#fb923c",
  "#facc15",
  "#fecaca",
  "#fed7aa",
  "#fef08a",
  "#bbf7d0",
  "#a5f3fc",
  "#bfdbfe",
  "#ddd6fe",
  "#fbcfe8",
];

export function isValidCategory(code: string): boolean {
  if (DEFAULT_CATS.some((c) => c.code === code)) return true;
  // Códigos de tabla (cXXXXXXXXXXX) o legados custom:....
  if (/^c[a-z0-9]{11}$/.test(code)) return true;
  if (!code.startsWith("custom:")) return false;
  return parseCat(code).label.length >= 2;
}

/** Resuelve un código contra el catálogo (tabla); si no existe, parseo local/legado. */
export function lookupCategory(
  code: string,
  rows: { code: string; name: string; iconName: string; color: string; kind: CatKind }[],
): CatInfo {
  const r = rows.find((x) => x.code === code);
  if (r) {
    return {
      code: r.code,
      icon: ICONS[r.iconName] ?? Shapes,
      iconName: r.iconName,
      label: r.name,
      color: r.color,
      custom: !DEFAULT_CATS.some((c) => c.code === code),
      kind: r.kind,
    };
  }
  return parseCat(code);
}

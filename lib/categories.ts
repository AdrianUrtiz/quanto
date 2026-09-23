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
  custom: boolean;
  kind: CatKind;
};
export type CustomCat = { code: string; iconName: string; label: string; kind: CatKind };

type Def = { code: string; icon: LucideIcon; iconName: string; label: string; kind: CatKind };

export const DEFAULT_CATS: Def[] = [
  { code: "COMIDA", icon: UtensilsCrossed, iconName: "UtensilsCrossed", label: "Comida", kind: "expense" },
  { code: "TRANSPORTE", icon: Car, iconName: "Car", label: "Transporte", kind: "expense" },
  { code: "VIVIENDA", icon: House, iconName: "House", label: "Vivienda", kind: "expense" },
  { code: "SERVICIOS", icon: Lightbulb, iconName: "Lightbulb", label: "Servicios", kind: "expense" },
  { code: "SALUD", icon: HeartPulse, iconName: "HeartPulse", label: "Salud", kind: "expense" },
  { code: "OCIO", icon: Clapperboard, iconName: "Clapperboard", label: "Ocio", kind: "expense" },
  { code: "COMPRAS", icon: ShoppingBag, iconName: "ShoppingBag", label: "Compras", kind: "expense" },
  { code: "EDUCACION", icon: GraduationCap, iconName: "GraduationCap", label: "Educación", kind: "expense" },
  { code: "VIAJES", icon: Plane, iconName: "Plane", label: "Viajes", kind: "expense" },
  { code: "MASCOTAS", icon: PawPrint, iconName: "PawPrint", label: "Mascotas", kind: "expense" },
  { code: "SUSCRIPCIONES", icon: Repeat, iconName: "Repeat", label: "Suscripciones", kind: "expense" },
  { code: "NOMINA", icon: Briefcase, iconName: "Briefcase", label: "Nómina", kind: "income" },
  { code: "TRANSFERENCIA", icon: Banknote, iconName: "Banknote", label: "Transferencia", kind: "income" },
  { code: "OTRO", icon: Shapes, iconName: "Shapes", label: "Otro", kind: "both" },
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

function fallback(code: string): CatInfo {
  return { code, icon: Shapes, iconName: "Shapes", label: cap(code), custom: false, kind: "both" };
}

export function parseCat(code: string): CatInfo {
  if (code.startsWith("custom:")) {
    const parts = code.split(":");
    // Nuevo: custom:{kind}:{iconName}:{NOMBRE} · legado: custom:{emoji}:{NOMBRE}.
    if (parts[1] === "expense" || parts[1] === "income") {
      const kind = parts[1];
      const iconName = parts[2] || "Shapes";
      const name = parts.slice(3).join(":").trim() || code;
      return { code, icon: ICONS[iconName] ?? Shapes, iconName, label: cap(name), custom: true, kind };
    }
    const name = parts.slice(2).join(":").trim() || code;
    return { code, icon: Shapes, iconName: "Shapes", label: cap(name), custom: true, kind: "expense" };
  }
  const d = DEFAULT_CATS.find((c) => c.code === code);
  if (d) return { ...d, custom: false };
  return fallback(code);
}

export function prettyCat(code: string): string {
  return parseCat(code).label;
}

export function makeCustomCat(iconName: string, name: string, kind: "expense" | "income" = "expense"): string {
  const clean = name.trim().toUpperCase().replace(/:/g, "").replace(/\s+/g, " ").slice(0, 30);
  return `custom:${kind}:${iconName}:${clean}`;
}

export function isValidCategory(code: string): boolean {
  if (DEFAULT_CATS.some((c) => c.code === code)) return true;
  if (!code.startsWith("custom:")) return false;
  return parseCat(code).label.length >= 2;
}

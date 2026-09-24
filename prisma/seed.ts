import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg(process.env["DATABASE_URL"] ?? "");
const prisma = new PrismaClient({ adapter });

// Seed alfa: 2 usuarios fijos (sin registro público) + catálogo global.
// Contraseña genérica alfa para ambos: quanto123.
async function main() {
  // Catálogo global de categorías (userId null = visible para todos).
  const defaults: { code: string; name: string; iconName: string; color: string; kind: string }[] = [
    { code: "COMIDA", name: "Comida", iconName: "UtensilsCrossed", color: "#fb923c", kind: "expense" },
    { code: "TRANSPORTE", name: "Transporte", iconName: "Car", color: "#38bdf8", kind: "expense" },
    { code: "VIVIENDA", name: "Vivienda", iconName: "House", color: "#a78bfa", kind: "expense" },
    { code: "SERVICIOS", name: "Servicios", iconName: "Lightbulb", color: "#facc15", kind: "expense" },
    { code: "SALUD", name: "Salud", iconName: "HeartPulse", color: "#f87171", kind: "expense" },
    { code: "OCIO", name: "Ocio", iconName: "Clapperboard", color: "#e879f9", kind: "expense" },
    { code: "COMPRAS", name: "Compras", iconName: "ShoppingBag", color: "#ec4899", kind: "expense" },
    { code: "EDUCACION", name: "Educación", iconName: "GraduationCap", color: "#818cf8", kind: "expense" },
    { code: "VIAJES", name: "Viajes", iconName: "Plane", color: "#22d3ee", kind: "expense" },
    { code: "MASCOTAS", name: "Mascotas", iconName: "PawPrint", color: "#a3e635", kind: "expense" },
    { code: "SUSCRIPCIONES", name: "Suscripciones", iconName: "Repeat", color: "#94a3b8", kind: "expense" },
    { code: "NOMINA", name: "Nómina", iconName: "Briefcase", color: "#34d399", kind: "income" },
    { code: "TRANSFERENCIA", name: "Transferencia", iconName: "Banknote", color: "#2dd4bf", kind: "income" },
    { code: "OTRO", name: "Otro", iconName: "Shapes", color: "#71717a", kind: "both" },
  ];
  for (const c of defaults) {
    // findFirst porque el único (userId null) no se puede buscar por where único.
    const existing = await prisma.category.findFirst({ where: { userId: null, code: c.code } });
    if (!existing) {
      await prisma.category.create({ data: { ...c, userId: null, isDefault: true } });
    }
  }

  // Usuarios alfa (los únicos; no hay registro público).
  const password = await bcrypt.hash("quanto123", 10);
  const seeds = [
    { username: "adrian", name: "Adrián" },
    { username: "michi", name: "Michi" },
  ];
  for (const s of seeds) {
    await prisma.user.upsert({
      where: { username: s.username },
      update: { password, name: s.name },
      create: { username: s.username, name: s.name, password },
    });
  }

  console.log("Seed OK: categorías + usuarios alfa (adrian, michi)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

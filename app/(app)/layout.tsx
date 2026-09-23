import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { Fab } from "@/components/fab";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS } from "@/lib/demo-data";
import { getCatalog } from "@/lib/catalog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";

  // Auto-reparación: si hay DB pero el id de la sesión no existe (sesión demo
  // vieja de antes de configurar Postgres), cerrar sesión y pedir login fresco.
  if (process.env.DATABASE_URL && meId) {
    try {
      const exists = await prisma.user.findUnique({ where: { id: meId }, select: { id: true } });
      if (!exists) {
        await signOut({ redirect: false });
        redirect("/login");
      }
    } catch {
      // Sin conexión a DB: no expulsar, los fallbacks demo ya cubren.
    }
  }

  // Privacidad: el FAB solo ofrece MIS cuentas. Nadie opera sobre cuentas ajenas.
  let accounts = DEMO_ACCOUNTS.filter((a) => a.ownerId === meId).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as "DEBIT" | "CREDIT",
  }));
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.account.findMany({
        where: { isActive: true, userId: meId },
        select: { id: true, name: true, type: true },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length) accounts = rows.map((r) => ({ id: r.id, name: r.name, type: r.type as "DEBIT" | "CREDIT" }));
    } catch {
      // fallback demo
    }
  }
  const catalog = await getCatalog(meId);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex-1 pb-44">{children}</main>
      <Fab accountOptions={accounts} cats={catalog} />
      <BottomNav />
    </div>
  );
}

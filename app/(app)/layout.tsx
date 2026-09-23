import { BottomNav } from "@/components/bottom-nav";
import { Fab } from "@/components/fab";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS } from "@/lib/demo-data";
import { parseCat, type CustomCat } from "@/lib/categories";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";

  // Privacidad: el FAB solo ofrece MIS cuentas. Nadie opera sobre cuentas ajenas.
  let accounts = DEMO_ACCOUNTS.filter((a) => a.ownerId === meId).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as "DEBIT" | "CREDIT",
  }));
  let customs: CustomCat[] = [];
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.account.findMany({
        where: { isActive: true, userId: meId },
        select: { id: true, name: true, type: true },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length) accounts = rows.map((r) => ({ id: r.id, name: r.name, type: r.type as "DEBIT" | "CREDIT" }));
      const catRows = await prisma.transaction.findMany({
        where: { createdById: meId },
        select: { category: true },
        distinct: ["category"],
      });
      customs = catRows
        .map((r) => parseCat(r.category))
        .filter((c) => c.custom)
        .map((c) => ({ code: c.code, emoji: c.emoji, label: c.label }));
    } catch {
      // fallback demo
    }
  }
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex-1 pb-44">{children}</main>
      <Fab accountOptions={accounts} customs={customs} />
      <BottomNav />
    </div>
  );
}

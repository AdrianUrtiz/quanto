import { BottomNav } from "@/components/bottom-nav";
import { Fab } from "@/components/fab";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS } from "@/lib/demo-data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let accounts = DEMO_ACCOUNTS.map((a) => ({ id: a.id, name: `${a.name} · ${a.owner}` }));
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.account.findMany({
        where: { isActive: true },
        select: { id: true, name: true, user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length) accounts = rows.map((r) => ({ id: r.id, name: `${r.name} · ${r.user.name}` }));
    } catch {
      // fallback demo
    }
  }
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex-1 pb-44">{children}</main>
      <Fab accountOptions={accounts} />
      <BottomNav />
    </div>
  );
}

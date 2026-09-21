import { BottomNav } from "@/components/bottom-nav";
import { Fab } from "@/components/fab";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS } from "@/lib/demo-data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";

  // Privacidad: el FAB solo ofrece MIS cuentas. Nadie opera sobre cuentas ajenas.
  let accounts = DEMO_ACCOUNTS.filter((a) => a.ownerId === meId).map((a) => ({
    id: a.id,
    name: a.name,
  }));
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.account.findMany({
        where: { isActive: true, userId: meId },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length) accounts = rows;
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

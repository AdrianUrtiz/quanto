import { redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { Fab } from "@/components/fab";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCatalog } from "@/lib/catalog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  if (!meId) redirect("/login");

  // Privacidad: el FAB solo ofrece MIS cuentas. Nadie opera sobre cuentas ajenas.
  const rows = await prisma.account.findMany({
    where: { isActive: true, userId: meId },
    select: { id: true, name: true, type: true },
    orderBy: { createdAt: "asc" },
  });
  const accounts = rows.map((r) => ({ id: r.id, name: r.name, type: r.type as "DEBIT" | "CREDIT" }));
  const catalog = await getCatalog(meId);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="pt-safe flex-1 pb-44">{children}</main>
      <Fab accountOptions={accounts} cats={catalog} />
      <BottomNav />
    </div>
  );
}

import { AppHeader } from "@/components/app-header";
import { CuentasClient } from "@/components/cuentas-client";
import type { AccountRow } from "@/components/account-card";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS } from "@/lib/demo-data";

export const metadata = { title: "Cuentas" };

export default async function CuentasPage() {
  const session = await auth();
  const me = session?.user?.name ?? "Adrián";

  let accounts: AccountRow[];
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.account.findMany({
        where: { isActive: true },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      accounts = rows.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type as "DEBIT" | "CREDIT",
        owner: a.user.name,
        balance: Number(a.balance),
        creditLimit: a.creditLimit ? Number(a.creditLimit) : undefined,
        statementDay: a.statementDay ?? undefined,
        dueDay: a.dueDay ?? undefined,
        lastFour: a.lastFour ?? undefined,
        color: a.color ?? "#6366f1",
      }));
    } catch {
      accounts = DEMO_ACCOUNTS as unknown as AccountRow[];
    }
  } else {
    accounts = DEMO_ACCOUNTS as unknown as AccountRow[];
  }

  return (
    <>
      <AppHeader title="Cuentas" />
      <CuentasClient accounts={accounts} me={me} />
    </>
  );
}

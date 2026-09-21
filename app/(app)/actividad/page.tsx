import { AppHeader } from "@/components/app-header";
import { ActivityClient } from "@/components/activity-client";
import type { TxRow } from "@/components/transaction-list";
import { prisma } from "@/lib/prisma";
import { DEMO_TXS } from "@/lib/demo-data";
import { monthKey, monthLabelEs } from "@/lib/utils";

export const metadata = { title: "Actividad" };
export const dynamic = "force-dynamic"; // el mes y los datos cambian por request

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

export default async function ActividadPage() {
  const now = new Date();
  const key = monthKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  let txs: TxRow[];
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.transaction.findMany({
        where: { date: { gte: start, lt: end } },
        include: { account: true, createdBy: true },
        orderBy: { date: "desc" },
      });
      txs = rows.map((t) => ({
        id: t.id,
        concept: t.concept,
        category: t.category,
        amount: Number(t.amount),
        date: t.date.toISOString(),
        type: t.type,
        accountName: t.account.name,
        creatorName: t.createdBy.name,
        installments: t.installments,
        isShared: t.isShared,
      }));
    } catch {
      txs = DEMO_TXS as unknown as TxRow[];
    }
  } else {
    txs = DEMO_TXS.map((t) => ({ ...t }));
  }

  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const daily = Array.from({ length: dim }, (_, i) => ({ day: i + 1, total: 0 }));
  let total = 0;
  for (const t of txs) {
    if (t.type !== "EXPENSE") continue;
    total += t.amount;
    const d = new Date(t.date).getDate();
    if (d >= 1 && d <= dim) daily[d - 1].total += t.amount;
  }

  const accountNames = [...new Set(txs.map((t) => t.accountName))];

  return (
    <>
      <AppHeader title="Actividad" />
      <ActivityClient
        txs={txs}
        daily={daily}
        total={total}
        monthLabel={monthLabelEs(now)}
        accountNames={accountNames}
      />
      <p className="sr-only">{key}</p>
    </>
  );
}

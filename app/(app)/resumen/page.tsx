import { AppHeader } from "@/components/app-header";
import { ResumenClient } from "@/components/resumen-client";
import { prisma } from "@/lib/prisma";
import { DEMO_TXS } from "@/lib/demo-data";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { settleMonth } from "@/lib/calculations";

export const metadata = { title: "Resumen" };
export const dynamic = "force-dynamic";

export default async function ResumenPage() {
  const now = new Date();
  const key = monthKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  type Full = {
    id: string; concept: string; category: string; amount: number; date: Date;
    type: string; installments: number; isShared: boolean;
    createdById: string; creatorName: string;
    shares: { debtorId: string; debtorName: string; sharePct: number; monthlyAmount: number }[];
  };

  let txs: Full[];
  if (process.env.DATABASE_URL) {
    try {
      const rows = await prisma.transaction.findMany({
        where: { date: { gte: start, lt: end }, type: "EXPENSE" },
        include: { createdBy: true, shares: { include: { debtor: true } } },
        orderBy: { date: "desc" },
      });
      txs = rows.map((t) => ({
        id: t.id, concept: t.concept, category: t.category, amount: Number(t.amount),
        date: t.date, type: t.type, installments: t.installments, isShared: t.isShared,
        createdById: t.createdById, creatorName: t.createdBy.name,
        shares: t.shares.map((s) => ({
          debtorId: s.debtorId, debtorName: s.debtor.name,
          sharePct: s.sharePct, monthlyAmount: Number(s.monthlyAmount),
        })),
      }));
    } catch {
      txs = DEMO_TXS.filter((t) => t.type === "EXPENSE").map((t) => ({ ...t, date: new Date(t.date) }));
    }
  } else {
    txs = DEMO_TXS.filter((t) => t.type === "EXPENSE").map((t) => ({ ...t, date: new Date(t.date) }));
  }

  const total = txs.reduce((a, t) => a + t.amount, 0);
  const byCat = new Map<string, number>();
  for (const t of txs) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
  const byCategory = [...byCat.entries()]
    .map(([label, value]) => ({ label: label.charAt(0) + label.slice(1).toLowerCase(), value }))
    .sort((a, b) => b.value - a.value);

  const settlement = settleMonth(txs, key);

  return (
    <>
      <AppHeader title="Resumen" />
      <ResumenClient total={total} byCategory={byCategory} settlement={settlement} monthLabel={monthLabelEs(now)} />
    </>
  );
}

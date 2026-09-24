import { redirect } from "next/navigation";
import { ResumenClient } from "@/components/resumen-client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { lookupCategory } from "@/lib/categories";
import { getCatalog } from "@/lib/catalog";
import { getLineSums } from "@/lib/debt-payments";
import { settleMonth } from "@/lib/calculations";

export const metadata = { title: "Resumen" };
export const dynamic = "force-dynamic";

export default async function ResumenPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  if (!meId) redirect("/login");
  const now = new Date();
  const key = monthKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  // Ventana amplia para compartidos: un MSI comprado hace meses sigue
  // generando parcialidad este mes.
  const sharedStart = new Date(now.getFullYear(), now.getMonth() - 24, 1);

  type Full = {
    id: string; concept: string; category: string; amount: number; date: Date;
    type: string; installments: number; isShared: boolean;
    createdById: string; creatorName: string;
    shares: { id: string; debtorId: string; debtorName: string; sharePct: number; monthlyAmount: number }[];
  };

  // Privacidad: el donut/categorías solo con MIS gastos. La liquidación solo
  // con compartidos donde estoy involucrado (soy quien compra o quien debe).
  const [mineRows, sharedRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: start, lt: end }, type: "EXPENSE", createdById: meId },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        date: { gte: sharedStart, lt: end },
        type: "EXPENSE",
        isShared: true,
        OR: [{ createdById: meId }, { shares: { some: { debtorId: meId } } }],
      },
      include: { createdBy: true, shares: { include: { debtor: true } } },
      orderBy: { date: "desc" },
    }),
  ]);
  const slim = (t: (typeof mineRows)[number]): Full => ({
    id: t.id, concept: t.concept, category: t.category, amount: Number(t.amount),
    date: t.date, type: t.type, installments: t.installments, isShared: t.isShared,
    createdById: t.createdById, creatorName: "",
    shares: [],
  });
  const mine: Full[] = mineRows.map(slim);
  const involved: Full[] = sharedRows.map((t) => ({
    ...slim(t),
    creatorName: t.createdBy.name,
    shares: t.shares.map((s) => ({
      id: s.id, debtorId: s.debtor.id, debtorName: s.debtor.name,
      sharePct: s.sharePct, monthlyAmount: Number(s.monthlyAmount),
    })),
  }));

  const total = mine.reduce((a, t) => a + t.amount, 0);
  const byCat = new Map<string, number>();
  for (const t of mine) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
  const catalog = await getCatalog(meId);
  const byCategory = [...byCat.entries()]
    .map(([code, value]) => {
      const c = lookupCategory(code, catalog);
      return { label: c.label, value, color: c.color };
    })
    .sort((a, b) => b.value - a.value);

  // Lo ya liquidado no suma al "por liquidar".
  const sums = await getLineSums(involved.flatMap((t) => t.shares.map((s) => s.id)));
  const confirmedMap = new Map([...sums.entries()].map(([k, s]) => [k, s.confirmed]));
  const settlement = settleMonth(involved, key, confirmedMap);

  return (
    <>
      <ResumenClient total={total} byCategory={byCategory} settlement={settlement} monthLabel={monthLabelEs(now)} />
    </>
  );
}

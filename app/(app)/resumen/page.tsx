import { AppHeader } from "@/components/app-header";
import { ResumenClient } from "@/components/resumen-client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_TXS } from "@/lib/demo-data";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { parseCat, prettyCat } from "@/lib/categories";
import { settleMonth } from "@/lib/calculations";

export const metadata = { title: "Resumen" };
export const dynamic = "force-dynamic";

export default async function ResumenPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";
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
    shares: { debtorId: string; debtorName: string; sharePct: number; monthlyAmount: number }[];
  };

  // Privacidad: el donut/categorías solo con MIS gastos. La liquidación solo
  // con compartidos donde estoy involucrado (soy quien compra o quien debe).
  let mine: Full[];
  let involved: Full[];
  if (process.env.DATABASE_URL) {
    try {
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
      mine = mineRows.map(slim);
      involved = sharedRows.map((t) => ({
        ...slim(t),
        creatorName: t.createdBy.name,
        shares: t.shares.map((s) => ({
          debtorId: s.debtorId, debtorName: s.debtor.name,
          sharePct: s.sharePct, monthlyAmount: Number(s.monthlyAmount),
        })),
      }));
    } catch {
      mine = [];
      involved = [];
    }
  } else {
    const demo = DEMO_TXS.map((t) => ({
      id: t.id, concept: t.concept, category: t.category, amount: t.amount,
      date: new Date(t.date), type: t.type, installments: t.installments, isShared: t.isShared,
      createdById: t.createdById, creatorName: t.creatorName,
      shares: t.shares.map((s) => ({ ...s })),
    }));
    mine = demo.filter((t) => t.createdById === meId);
    involved = demo.filter(
      (t) => t.isShared && (t.createdById === meId || t.shares.some((s) => s.debtorId === meId))
    );
  }

  const total = mine.reduce((a, t) => a + t.amount, 0);
  const byCat = new Map<string, number>();
  for (const t of mine) byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount);
  const byCategory = [...byCat.entries()]
    .map(([code, value]) => ({ label: prettyCat(code), value, color: parseCat(code).color }))
    .sort((a, b) => b.value - a.value);

  const settlement = settleMonth(involved, key);

  return (
    <>
      <AppHeader title="Resumen" />
      <ResumenClient total={total} byCategory={byCategory} settlement={settlement} monthLabel={monthLabelEs(now)} />
    </>
  );
}

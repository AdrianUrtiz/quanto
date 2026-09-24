import { prisma } from "@/lib/prisma";

export type LineSums = { confirmed: number; pending: number };

/** Suma CONFIRMED/PENDING por línea (shareId + month "YYYY-MM"). */
export async function getLineSums(shareIds: string[]): Promise<Map<string, LineSums>> {
  const map = new Map<string, LineSums>();
  if (!shareIds.length) return map;
  const rows = await prisma.debtPayment.findMany({
    where: { shareId: { in: shareIds }, status: { in: ["PENDING", "CONFIRMED"] } },
    select: { shareId: true, month: true, amount: true, status: true },
  });
  for (const r of rows) {
    const key = `${r.shareId}:${r.month}`;
    const s = map.get(key) ?? { confirmed: 0, pending: 0 };
    if (r.status === "CONFIRMED") s.confirmed += Number(r.amount);
    else s.pending += Number(r.amount);
    map.set(key, s);
  }
  return map;
}

export function lineRemaining(monthly: number, sums?: LineSums): number {
  return Math.max(0, monthly - (sums?.confirmed ?? 0));
}

export function lineKey(shareId: string, month: string): string {
  return `${shareId}:${month}`;
}

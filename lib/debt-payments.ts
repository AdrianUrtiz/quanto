import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Cliente capaz de correr dentro o fuera de una transacción. */
export type TxDb = Prisma.TransactionClient;

export type LineSums = { confirmed: number; pending: number };

/** Suma CONFIRMED/PENDING por línea (shareId + month "YYYY-MM"). */
export async function getLineSums(shareIds: string[], db: TxDb = prisma): Promise<Map<string, LineSums>> {
  const map = new Map<string, LineSums>();
  if (!shareIds.length) return map;
  const rows = await db.debtPayment.findMany({
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

/**
 * Crea el ingreso del acreedor (cobro de pareja) + mueve el saldo.
 * Categoría fija TRANSFERENCIA. Corre dentro o fuera de transacción.
 * La validación de categoría y propiedad de la cuenta la hace el llamador.
 */
export async function createCreditorIncome(
  db: TxDb,
  opts: {
    amount: number;
    concept: string;
    accountId: string;
    accountType: string;
    userId: string;
  },
): Promise<string> {
  const tx = await db.transaction.create({
    data: {
      type: "INCOME",
      amount: opts.amount,
      concept: opts.concept,
      category: "TRANSFERENCIA",
      date: new Date(),
      accountId: opts.accountId,
      createdById: opts.userId,
      installments: 1,
      isShared: false,
    },
  });
  await db.account.update({
    where: { id: opts.accountId },
    data:
      opts.accountType === "CREDIT"
        ? { balance: { decrement: opts.amount } }
        : { balance: { increment: opts.amount } },
  });
  return tx.id;
}

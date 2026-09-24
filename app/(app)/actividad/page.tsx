import { ActivityClient, type MonthOpt } from "@/components/activity-client";
import { DueSubscriptions } from "@/components/due-subscriptions";
import type { TxRow } from "@/components/transaction-list";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS, DEMO_TXS } from "@/lib/demo-data";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { computeDues, type DueCharge } from "@/lib/subscriptions";
import { getCatalog } from "@/lib/catalog";

export const metadata = { title: "Actividad" };
export const dynamic = "force-dynamic"; // el mes y los datos cambian por request

export default async function ActividadPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";

  // Sin cota inferior: "Todo el tiempo" debe ser literal (escala personal).

  // Privacidad: solo MIS movimientos. Lo que gasta mi pareja no aparece aquí;
  // lo que le debo vive en Cuentas > Mi pareja y en el Resumen.
  type Raw = {
    id: string;
    concept: string;
    category: string;
    amount: number;
    date: Date;
    type: string;
    accountId: string;
    accountName: string;
    accountType: string;
    transferToAccountId?: string | null;
    transferToAccountName?: string | null;
    transferToAccountType?: string | null;
    creatorName: string;
    installments: number;
    isShared: boolean;
    createdById: string;
  };

  let raw: Raw[];
  if (process.env.DATABASE_URL) {
    try {
      const [rows, accRows] = await Promise.all([
        prisma.transaction.findMany({
          where: { createdById: meId },
          include: { account: true, createdBy: true },
          orderBy: { date: "desc" },
        }),
        prisma.account.findMany({
          where: { userId: meId },
          select: { id: true, name: true, type: true },
        }),
      ]);
      const accById = new Map(accRows.map((a) => [a.id, a]));
      raw = rows.map((t) => ({
        id: t.id,
        concept: t.concept,
        category: t.category,
        amount: Number(t.amount),
        date: t.date,
        type: t.type,
        accountId: t.accountId,
        accountName: t.account.name,
        accountType: t.account.type,
        transferToAccountId: t.transferToAccountId ?? null,
        transferToAccountName: t.transferToAccountId
          ? (accById.get(t.transferToAccountId)?.name ?? null)
          : null,
        transferToAccountType: t.transferToAccountId
          ? (accById.get(t.transferToAccountId)?.type ?? null)
          : null,
        creatorName: t.createdBy.name,
        installments: t.installments,
        isShared: t.isShared,
        createdById: t.createdById,
      }));
    } catch {
      raw = DEMO_TXS.filter((t) => t.createdById === meId).map((t) => ({
        ...t,
        date: new Date(t.date),
        accountName: t.accountName,
        accountType:
          DEMO_ACCOUNTS.find((a) => a.id === t.accountId)?.type ?? "DEBIT",
        transferToAccountId: null,
        transferToAccountName: null,
        transferToAccountType: null,
        creatorName: t.creatorName,
      }));
    }
  } else {
    raw = DEMO_TXS.filter((t) => t.createdById === meId).map((t) => ({
      ...t,
      date: new Date(t.date),
      accountName: t.accountName,
      accountType:
        DEMO_ACCOUNTS.find((a) => a.id === t.accountId)?.type ?? "DEBIT",
      transferToAccountId: null,
      transferToAccountName: null,
      transferToAccountType: null,
      creatorName: t.creatorName,
    }));
  }

  const txs: TxRow[] = raw.map((t) => ({ ...t, date: t.date.toISOString() }));
  const catalog = await getCatalog(meId);

  // Meses con registro (solo gastos suman al total del selector).
  const totals = new Map<string, number>();
  for (const t of raw) {
    if (t.type !== "EXPENSE") continue;
    const k = monthKey(new Date(t.date));
    totals.set(k, (totals.get(k) ?? 0) + t.amount);
  }
  const current = monthKey(new Date());
  if (!totals.has(current)) totals.set(current, 0);
  const months: MonthOpt[] = [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, total]) => {
      const [y, m] = key.split("-").map(Number);
      return { key, label: monthLabelEs(new Date(y, m - 1, 1)), total };
    });

  // Suscripciones: cargos pendientes por confirmar (solo mías).
  let dues: DueCharge[] = [];
  if (process.env.DATABASE_URL) {
    try {
      const [subRows, confirmedRows] = await Promise.all([
        prisma.subscription.findMany({
          where: { userId: meId },
          include: { account: true },
        }),
        prisma.transaction.findMany({
          where: { createdById: meId, subscriptionId: { not: null } },
          select: { subscriptionId: true, date: true },
        }),
      ]);
      const confirmed = new Set(
        confirmedRows
          .filter((t) => t.subscriptionId)
          .map((t) => `${t.subscriptionId}:${monthKey(new Date(t.date))}`),
      );
      dues = computeDues(
        subRows.map((s) => ({
          id: s.id,
          name: s.name,
          amount: Number(s.amount),
          accountId: s.accountId,
          accountName: s.account.name,
          chargeDay: s.chargeDay,
          isShared: s.isShared,
          sharePct: s.sharePct,
          shareAmount: s.shareAmount ? Number(s.shareAmount) : null,
          isActive: s.isActive,
          startMonth: s.startMonth,
        })),
        confirmed,
      );
    } catch {
      dues = [];
    }
  }

  return (
    <>
      <DueSubscriptions dues={dues} />
      <ActivityClient txs={txs} months={months} cats={catalog} />
    </>
  );
}

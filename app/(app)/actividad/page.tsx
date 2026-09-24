import { redirect } from "next/navigation";
import { ActivityClient, type MonthOpt } from "@/components/activity-client";
import { PendingPaymentsBanner } from "@/components/pending-payments-banner";
import { SourceConfirmBanner } from "@/components/source-confirm-banner";
import type { ToConfirmItem, SourceConfirmItem } from "@/components/cuentas-client";
import type { TxRow } from "@/components/transaction-list";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { getCatalog } from "@/lib/catalog";

export const metadata = { title: "Actividad" };
export const dynamic = "force-dynamic"; // el mes y los datos cambian por request

export default async function ActividadPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  if (!meId) redirect("/login");

  // Sin cota inferior: "Todo el tiempo" debe ser literal (escala personal).

  // Privacidad: solo MIS movimientos. Lo que gasta mi pareja no aparece aquí;
  // lo que le debo vive en Cuentas > Mi pareja y en el Resumen.
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
  const raw = rows.map((t) => ({
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

  // Movimientos huella de pagos CONFIRMED (ingreso del cobro o egreso del
  // origen): solo lectura, sin acciones de editar/eliminar.
  const lockedRows = await prisma.debtPayment.findMany({
    where: {
      status: "CONFIRMED",
      share: { OR: [{ debtorId: meId }, { transaction: { createdById: meId } }] },
    },
    select: { transactionId: true, debtorTransactionId: true },
  });
  const lockedTxIds = new Set(
    lockedRows.flatMap((p) => [p.transactionId, p.debtorTransactionId]).filter((id) => id != null),
  );

  const txs: TxRow[] = raw.map((t) => ({ ...t, date: t.date.toISOString(), locked: lockedTxIds.has(t.id) }));
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

  // Pagos de pareja pendientes de mi confirmación + mis cuentas (destino).
  const [mineAccounts, pendingRows, sourceRows] = await Promise.all([
    prisma.account.findMany({
      where: { isActive: true, userId: meId },
      select: { id: true, name: true, type: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.debtPayment.findMany({
      where: {
        status: "PENDING",
        share: {
          OR: [{ debtorId: meId }, { transaction: { createdById: meId } }],
        },
      },
      include: {
        share: { include: { transaction: true } },
        registeredBy: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.debtPayment.findMany({
      where: {
        status: "CONFIRMED",
        debtorConfirmedAt: null,
        registeredById: { not: meId },
        share: { debtorId: meId },
      },
      include: {
        share: { include: { transaction: { include: { createdBy: true } } } },
        registeredBy: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const accountOptions = mineAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as "DEBIT" | "CREDIT",
  }));
  const toConfirm: ToConfirmItem[] = pendingRows
    .filter((p) => p.registeredById !== meId)
    .map((p) => {
      const [y, mo] = p.month.split("-").map(Number);
      return {
        id: p.id,
        amount: Number(p.amount),
        month: p.month,
        monthLabel: monthLabelEs(new Date(y, mo - 1, 1)),
        concept: p.share.transaction.concept,
        monthly: Number(p.share.monthlyAmount),
        shareId: p.shareId,
        registeredByName: p.registeredBy.name,
      };
    });
  const toConfirmSource: SourceConfirmItem[] = sourceRows.map((p) => {
    const [y, mo] = p.month.split("-").map(Number);
    return {
      id: p.id,
      amount: Number(p.amount),
      month: p.month,
      monthLabel: monthLabelEs(new Date(y, mo - 1, 1)),
      concept: p.share.transaction.concept,
      creditorName: p.registeredBy.name,
    };
  });

  return (
    <>
      <PendingPaymentsBanner
        items={toConfirm}
        accountOptions={accountOptions}
      />
      <SourceConfirmBanner
        items={toConfirmSource}
        accountOptions={accountOptions}
      />
      <ActivityClient txs={txs} months={months} cats={catalog} />
    </>
  );
}

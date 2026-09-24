import { redirect } from "next/navigation";
import { CuentasClient, type MyPendingItem, type PartnerDebt, type ToConfirmItem } from "@/components/cuentas-client";
import type { SubPayState } from "@/components/subscription-tab";
import type { AccountRow } from "@/components/account-card";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { installmentMonths } from "@/lib/calculations";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { computeDues, type DueCharge } from "@/lib/subscriptions";
import { getLineSums, type LineSums } from "@/lib/debt-payments";
import { getCatalog } from "@/lib/catalog";
import type { SubRow } from "@/components/subscription-tab";

export const metadata = { title: "Cuentas" };

type DebtItem = {
  shareId: string;
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  dueDay?: number;
  debtorId: string;
  debtorName: string;
  creditorName: string;
  concept: string;
  monthly: number;
  installments: number;
  date: Date;
};

/**
 * Agrupa por cuenta+deudor solo lo exigible en el mes `key`.
 * Si la compra fue a MSI, únicamente cae la parcialidad del periodo actual.
 */
function buildDebts(items: DebtItem[], key: string, sums: Map<string, LineSums>): PartnerDebt[] {
  const byAcc = new Map<string, PartnerDebt>();
  for (const it of items) {
    const months = installmentMonths(new Date(it.date), it.installments);
    const idx = months.indexOf(key);
    if (idx === -1) continue; // fuera del periodo actual
    const gk = `${it.accountId}:${it.debtorId}`;
    const g = byAcc.get(gk) ?? {
      accountId: it.accountId,
      accountName: it.accountName,
      accountType: it.accountType,
      dueDay: it.dueDay,
      debtorId: it.debtorId,
      debtorName: it.debtorName,
      creditorName: it.creditorName,
      total: 0,
      lines: [],
    };
    g.total += it.monthly;
    const s = sums.get(`${it.shareId}:${key}`) ?? { confirmed: 0, pending: 0 };
    g.lines.push({
      concept: it.concept,
      monthly: it.monthly,
      installment: idx + 1,
      installments: it.installments,
      shareId: it.shareId || null,
      month: key,
      paid: s.confirmed,
      pending: s.pending,
    });
    byAcc.set(gk, g);
  }
  return [...byAcc.values()].sort((a, b) => b.total - a.total);
}

export default async function CuentasPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  if (!meId) redirect("/login");
  const me = session?.user?.name ?? "Tú";
  const key = monthKey(new Date());

  let accounts: AccountRow[];
  let debts: PartnerDebt[];
  let owed: PartnerDebt[];
  let subs: SubRow[] = [];
  let dues: DueCharge[] = [];
  const toConfirm: ToConfirmItem[] = [];
  const myPending: MyPendingItem[] = [];
  let payStates: SubPayState[] = [];
  const [accRows, sharedRows, sharedOwedRows, subRows, confirmedRows] = await Promise.all([
        // Privacidad: ni siquiera se consultan las cuentas de la pareja.
        prisma.account.findMany({
          where: { isActive: true, userId: meId },
          include: { user: true },
          orderBy: { createdAt: "asc" },
        }),
        // Solo movimientos creados por mi pareja donde YO soy el deudor.
        prisma.transaction.findMany({
          where: {
            isShared: true,
            createdById: { not: meId },
            shares: { some: { debtorId: meId } },
          },
          include: {
            account: true,
            createdBy: true,
            shares: { where: { debtorId: meId } },
          },
          orderBy: { date: "asc" },
        }),
        // Compras MÍAS compartidas donde mi pareja es la deudora (me deben).
        prisma.transaction.findMany({
          where: {
            isShared: true,
            createdById: meId,
            shares: { some: { debtorId: { not: meId } } },
          },
          include: {
            account: true,
            createdBy: true,
            shares: { include: { debtor: true } },
          },
          orderBy: { date: "asc" },
        }),
        prisma.subscription.findMany({
          where: { userId: meId },
          include: { account: true },
          orderBy: { createdAt: "asc" },
        }),
        prisma.transaction.findMany({
          where: { createdById: meId, subscriptionId: { not: null } },
          select: { subscriptionId: true, date: true },
        }),
      ]);
      accounts = accRows.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type as "DEBIT" | "CREDIT",
        owner: a.user.name,
        ownerId: a.user.id,
        balance: Number(a.balance),
        creditLimit: a.creditLimit ? Number(a.creditLimit) : undefined,
        statementDay: a.statementDay ?? undefined,
        dueDay: a.dueDay ?? undefined,
        lastFour: a.lastFour ?? undefined,
        expiry: a.expiry ?? undefined,
        color: a.color ?? "#6366f1",
      }));
      // Pagos de pareja: sumas por línea + pendientes donde participo.
      const allShareIds = [
        ...sharedRows.flatMap((t) => t.shares.map((s) => s.id)),
        ...sharedOwedRows.flatMap((t) => t.shares.map((s) => s.id)),
      ];
      const [sums, pendingRows] = await Promise.all([
        getLineSums(allShareIds),
        prisma.debtPayment.findMany({
          where: {
            status: "PENDING",
            share: { OR: [{ debtorId: meId }, { transaction: { createdById: meId } }] },
          },
          include: {
            share: { include: { transaction: { include: { createdBy: true } }, debtor: true } },
            registeredBy: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const monthLabelOf = (m: string) => {
        const [y, mo] = m.split("-").map(Number);
        return monthLabelEs(new Date(y, mo - 1, 1));
      };
      for (const p of pendingRows) {
        const base = {
          id: p.id,
          amount: Number(p.amount),
          month: p.month,
          monthLabel: monthLabelOf(p.month),
          concept: p.share.transaction.concept,
          monthly: Number(p.share.monthlyAmount),
          shareId: p.shareId,
        };
        if (p.registeredById === meId) {
          // Yo (deudor) lo registré → espera confirmación del acreedor.
          myPending.push({ ...base, confirmerName: p.share.transaction.createdBy.name });
        } else {
          // PENDING siempre lo registró el deudor → yo soy el acreedor que confirma.
          toConfirm.push({ ...base, registeredByName: p.registeredBy.name });
        }
      }
      debts = buildDebts(
        sharedRows.map((t) => ({
          shareId: t.shares[0]?.id ?? "",
          accountId: t.account.id,
          accountName: t.account.name,
          accountType: t.account.type as "DEBIT" | "CREDIT",
          dueDay: t.account.dueDay ?? undefined,
          debtorId: meId,
          debtorName: me,
          creditorName: t.createdBy.name,
          concept: t.concept,
          monthly: Number(t.shares[0]?.monthlyAmount ?? 0),
          installments: t.installments,
          date: t.date,
        })),
        key,
        sums
      );
      owed = buildDebts(
        sharedOwedRows.flatMap((t) =>
          t.shares
            .filter((s) => s.debtorId !== meId)
            .map((s) => ({
              shareId: s.id,
              accountId: t.account.id,
              accountName: t.account.name,
              accountType: t.account.type as "DEBIT" | "CREDIT",
              dueDay: t.account.dueDay ?? undefined,
              debtorId: s.debtorId,
              debtorName: s.debtor.name,
              creditorName: t.createdBy.name,
              concept: t.concept,
              monthly: Number(s.monthlyAmount ?? 0),
              installments: t.installments,
              date: t.date,
            })),
        ),
        key,
        sums
      );
      subs = subRows.map((s) => ({
        id: s.id,
        name: s.name,
        amount: Number(s.amount),
        category: s.category,
        accountId: s.accountId,
        accountName: s.account.name,
        chargeDay: s.chargeDay,
        isShared: s.isShared,
        sharePct: s.sharePct,
        shareAmount: s.shareAmount ? Number(s.shareAmount) : null,
        isActive: s.isActive,
      }));
      const infos = subRows.map((s) => ({
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
      }));
      const confirmed = new Set(
        confirmedRows
          .filter((t) => t.subscriptionId)
          .map((t) => `${t.subscriptionId}:${monthKey(new Date(t.date))}`),
      );
      dues = computeDues(infos, confirmed);

      // Estado de pago por suscripción (mes pendiente o actual).
      if (subRows.length) {
        const subIds = subRows.map((s) => s.id);
        const [subTxs, subShares] = await Promise.all([
          prisma.transaction.findMany({
            where: { createdById: meId, subscriptionId: { in: subIds } },
            select: { subscriptionId: true, date: true },
          }),
          prisma.transactionShare.findMany({
            where: { transaction: { subscriptionId: { in: subIds }, createdById: meId } },
            select: {
              id: true,
              monthlyAmount: true,
              transaction: { select: { subscriptionId: true, date: true } },
            },
          }),
        ]);
        const txMonth = new Set(
          subTxs.filter((t) => t.subscriptionId).map((t) => `${t.subscriptionId}:${monthKey(new Date(t.date))}`),
        );
        const shareBySubMonth = new Map(
          subShares
            .filter((s) => s.transaction.subscriptionId)
            .map((s) => [`${s.transaction.subscriptionId}:${monthKey(new Date(s.transaction.date))}`, s]),
        );
        const sums = await getLineSums(subShares.map((s) => s.id));
        const dueBySub = new Map(dues.map((d) => [d.id, d]));
        const accTypeById = new Map(accounts.map((a) => [a.id, a.type]));
        payStates = subRows.map((s) => {
          const due = dueBySub.get(s.id);
          const month = due?.monthKey ?? key;
          const [yy, mm] = month.split("-").map(Number);
          const sh = shareBySubMonth.get(`${s.id}:${month}`);
          const monthly = due?.monthlyShare ?? (sh ? Number(sh.monthlyAmount) : 0);
          const sl = sh ? (sums.get(`${sh.id}:${month}`) ?? { confirmed: 0, pending: 0 }) : { confirmed: 0, pending: 0 };
          return {
            subId: s.id,
            month,
            monthLabel: monthLabelEs(new Date(yy, mm - 1, 1)),
            chargeConfirmed: txMonth.has(`${s.id}:${month}`),
            shareId: sh?.id ?? null,
            monthly,
            paid: sl.confirmed,
            pending: sl.pending,
            accountType: accTypeById.get(s.accountId) ?? "DEBIT",
          };
        });
      }

  const catalog = await getCatalog(meId);

  return (
    <>
      <CuentasClient accounts={accounts} meId={meId} debts={debts} owed={owed} subs={subs} dues={dues} cats={catalog} toConfirm={toConfirm} myPending={myPending} payStates={payStates} />
    </>
  );
}

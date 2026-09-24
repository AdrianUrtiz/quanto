import { CuentasClient, type MyPendingItem, type PartnerDebt, type ToConfirmItem } from "@/components/cuentas-client";
import type { AccountRow } from "@/components/account-card";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS, DEMO_TXS } from "@/lib/demo-data";
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

function demoDebts(me: string, meId: string, key: string): PartnerDebt[] {
  const items: DebtItem[] = [];
  for (const t of DEMO_TXS) {
    if (!t.isShared || t.createdById === meId) continue;
    const share = t.shares.find((s) => s.debtorId === meId);
    if (!share) continue;
    const acc = DEMO_ACCOUNTS.find((a) => a.id === t.accountId);
    if (!acc) continue;
    items.push({
      shareId: "",
      accountId: acc.id,
      accountName: acc.name,
      accountType: acc.type,
      dueDay: acc.dueDay,
      debtorId: meId,
      debtorName: me,
      creditorName: t.creatorName,
      concept: t.concept,
      monthly: share.monthlyAmount,
      installments: t.installments,
      date: new Date(t.date),
    });
  }
  return buildDebts(items, key, new Map());
}

function demoOwed(meId: string, key: string): PartnerDebt[] {
  const items: DebtItem[] = [];
  for (const t of DEMO_TXS) {
    if (!t.isShared || t.createdById !== meId) continue;
    const acc = DEMO_ACCOUNTS.find((a) => a.id === t.accountId);
    if (!acc) continue;
    for (const share of t.shares) {
      if (share.debtorId === meId) continue;
      items.push({
        shareId: "",
        accountId: acc.id,
        accountName: acc.name,
        accountType: acc.type,
        dueDay: acc.dueDay,
        debtorId: share.debtorId,
        debtorName: share.debtorName,
        creditorName: t.creatorName,
        concept: t.concept,
        monthly: share.monthlyAmount,
        installments: t.installments,
        date: new Date(t.date),
      });
    }
  }
  return buildDebts(items, key, new Map());
}

function demoAccounts(): AccountRow[] {
  return DEMO_ACCOUNTS.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    owner: a.owner,
    ownerId: a.ownerId,
    balance: a.balance,
    creditLimit: a.creditLimit,
    statementDay: a.statementDay,
    dueDay: a.dueDay,
    lastFour: a.lastFour,
    color: a.color,
  }));
}

export default async function CuentasPage() {
  const session = await auth();
  const me = session?.user?.name ?? "Tú";
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";
  const key = monthKey(new Date());

  let accounts: AccountRow[];
  let debts: PartnerDebt[];
  let owed: PartnerDebt[];
  let subs: SubRow[] = [];
  let dues: DueCharge[] = [];
  const toConfirm: ToConfirmItem[] = [];
  const myPending: MyPendingItem[] = [];
  if (process.env.DATABASE_URL) {
    try {
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
    } catch {
      accounts = demoAccounts();
      debts = demoDebts(me, meId, key);
      owed = demoOwed(meId, key);
    }
  } else {
    accounts = demoAccounts();
    debts = demoDebts(me, meId, key);
    owed = demoOwed(meId, key);
  }

  const catalog = await getCatalog(meId);

  return (
    <>
      <CuentasClient accounts={accounts} meId={meId} debts={debts} owed={owed} subs={subs} dues={dues} cats={catalog} toConfirm={toConfirm} myPending={myPending} />
    </>
  );
}

import { redirect } from "next/navigation";
import { CuentasClient, type MyPendingItem, type PartnerDebt, type SourceConfirmItem, type ToConfirmItem } from "@/components/cuentas-client";
import type { AccountRow } from "@/components/account-card";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { installmentMonths } from "@/lib/calculations";
import { monthKey, monthLabelEs } from "@/lib/utils";
import { getSubscriptionData, type SubFull } from "@/lib/subscription-actions";
import type { DueCharge } from "@/lib/subscriptions";
import { getLineSums, type LineSums } from "@/lib/debt-payments";
import { getAccountBalances } from "@/lib/balances";
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
      remaining: 0,
      lines: [],
    };
    g.total += it.monthly;
    const s = sums.get(`${it.shareId}:${key}`) ?? { confirmed: 0, pending: 0 };
    g.remaining += Math.max(0, it.monthly - s.confirmed);
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
  return [...byAcc.values()].sort((a, b) => b.remaining - a.remaining);
}

export default async function CuentasPage() {
  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id;
  if (!meId) redirect("/login");
  const me = session?.user?.name ?? "Tú";
  const key = monthKey(new Date());

  let subs: SubRow[] = [];
  let dues: DueCharge[] = [];
  const toConfirm: ToConfirmItem[] = [];
  const myPending: MyPendingItem[] = [];
  const toConfirmSource: SourceConfirmItem[] = [];
  const [accRows, sharedRows, sharedOwedRows] = await Promise.all([
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
  ]);
  const balances = await getAccountBalances(meId);
  const accounts: AccountRow[] = accRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type as "DEBIT" | "CREDIT",
    owner: a.user.name,
    ownerId: a.user.id,
    balance: balances.get(a.id) ?? (a.type === "DEBIT" ? Number(a.initialBalance ?? 0) : 0),
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
      const [sums, pendingRows, sourceRows] = await Promise.all([
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
        // Cobros que el acreedor dice recibidos y esperan que yo indique la cuenta origen.
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
      for (const p of sourceRows) {
        toConfirmSource.push({
          id: p.id,
          amount: Number(p.amount),
          month: p.month,
          monthLabel: monthLabelOf(p.month),
          concept: p.share.transaction.concept,
          creditorName: p.registeredBy.name,
        });
      }
      const debts = buildDebts(
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
      const owed = buildDebts(
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
      // Suscripciones (mías + compartidas de mi pareja) y sus pendientes.
      const subData = await getSubscriptionData(meId);
      subs = subData.subs;
      dues = subData.dues;

  const catalog = await getCatalog(meId);

  return (
    <>
      <CuentasClient accounts={accounts} meId={meId} debts={debts} owed={owed} subs={subs} dues={dues} cats={catalog} toConfirm={toConfirm} myPending={myPending} toConfirmSource={toConfirmSource} />
    </>
  );
}

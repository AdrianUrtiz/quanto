import { AppHeader } from "@/components/app-header";
import { CuentasClient, type PartnerDebt } from "@/components/cuentas-client";
import type { AccountRow } from "@/components/account-card";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_ACCOUNTS, DEMO_TXS } from "@/lib/demo-data";
import { installmentMonths } from "@/lib/calculations";
import { monthKey } from "@/lib/utils";

export const metadata = { title: "Cuentas" };

type DebtItem = {
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  dueDay?: number;
  creditorName: string;
  concept: string;
  monthly: number;
  installments: number;
  date: Date;
};

/**
 * Agrupa por cuenta solo lo exigible en el mes `key`.
 * Si la compra fue a MSI, únicamente cae la parcialidad del periodo actual.
 */
function buildDebts(items: DebtItem[], key: string): PartnerDebt[] {
  const byAcc = new Map<string, PartnerDebt>();
  for (const it of items) {
    const months = installmentMonths(new Date(it.date), it.installments);
    const idx = months.indexOf(key);
    if (idx === -1) continue; // fuera del periodo actual
    const g = byAcc.get(it.accountId) ?? {
      accountId: it.accountId,
      accountName: it.accountName,
      accountType: it.accountType,
      dueDay: it.dueDay,
      creditorName: it.creditorName,
      total: 0,
      lines: [],
    };
    g.total += it.monthly;
    g.lines.push({
      concept: it.concept,
      monthly: it.monthly,
      installment: idx + 1,
      installments: it.installments,
    });
    byAcc.set(it.accountId, g);
  }
  return [...byAcc.values()].sort((a, b) => b.total - a.total);
}

function demoDebts(meId: string, key: string): PartnerDebt[] {
  const items: DebtItem[] = [];
  for (const t of DEMO_TXS) {
    if (!t.isShared || t.createdById === meId) continue;
    const share = t.shares.find((s) => s.debtorId === meId);
    if (!share) continue;
    const acc = DEMO_ACCOUNTS.find((a) => a.id === t.accountId);
    if (!acc) continue;
    items.push({
      accountId: acc.id,
      accountName: acc.name,
      accountType: acc.type,
      dueDay: acc.dueDay,
      creditorName: t.creatorName,
      concept: t.concept,
      monthly: share.monthlyAmount,
      installments: t.installments,
      date: new Date(t.date),
    });
  }
  return buildDebts(items, key);
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
  const meId = (session?.user as { id?: string } | undefined)?.id ?? "u-adrian";
  const key = monthKey(new Date());

  let accounts: AccountRow[];
  let debts: PartnerDebt[];
  if (process.env.DATABASE_URL) {
    try {
      const [accRows, sharedRows] = await Promise.all([
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
      debts = buildDebts(
        sharedRows.map((t) => ({
          accountId: t.account.id,
          accountName: t.account.name,
          accountType: t.account.type as "DEBIT" | "CREDIT",
          dueDay: t.account.dueDay ?? undefined,
          creditorName: t.createdBy.name,
          concept: t.concept,
          monthly: Number(t.shares[0]?.monthlyAmount ?? 0),
          installments: t.installments,
          date: t.date,
        })),
        key
      );
    } catch {
      accounts = demoAccounts();
      debts = demoDebts(meId, key);
    }
  } else {
    accounts = demoAccounts();
    debts = demoDebts(meId, key);
  }

  return (
    <>
      <AppHeader title="Cuentas" />
      <CuentasClient accounts={accounts} meId={meId} debts={debts} />
    </>
  );
}

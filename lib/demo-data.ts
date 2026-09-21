// Datos demo para que la UI funcione sin base de datos configurada.
// En cuanto DATABASE_URL exista, las páginas usan Prisma (ver lib/actions.ts).

export type DemoAccount = {
  id: string;
  name: string;
  type: "DEBIT" | "CREDIT";
  owner: string;
  ownerId: string;
  balance: number;
  creditLimit?: number;
  statementDay?: number;
  dueDay?: number;
  lastFour?: string;
  color: string;
};

export type DemoTx = {
  id: string;
  concept: string;
  category: string;
  amount: number;
  date: string; // ISO
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  accountId: string;
  accountName: string;
  creatorName: string;
  createdById: string;
  installments: number;
  isShared: boolean;
  shares: { debtorId: string; debtorName: string; sharePct: number; monthlyAmount: number }[];
};

export const DEMO_USERS = [
  { id: "u-adrian", name: "Adrián" },
  { id: "u-pareja", name: "Pareja" },
];

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: "a-main", name: "Main account", type: "DEBIT", owner: "Adrián", ownerId: "u-adrian", balance: 12500, lastFour: "1234", color: "#6366f1" },
  { id: "a-nu", name: "Tarjeta Crédito", type: "CREDIT", owner: "Adrián", ownerId: "u-adrian", balance: 3000, creditLimit: 50000, statementDay: 15, dueDay: 5, lastFour: "5678", color: "#a855f7" },
  { id: "a-pareja", name: "Débito Pareja", type: "DEBIT", owner: "Pareja", ownerId: "u-pareja", balance: 8200, lastFour: "9876", color: "#22c55e" },
];

const today = new Date();
const iso = (day: number) =>
  new Date(today.getFullYear(), today.getMonth(), day, 12, 0, 0).toISOString();

export const DEMO_TXS: DemoTx[] = [
  {
    id: "t1", concept: "Super compartido (3 MSI)", category: "COMIDA", amount: 3000,
    date: iso(Math.min(today.getDate(), 5)), type: "EXPENSE",
    accountId: "a-nu", accountName: "Tarjeta Crédito",
    creatorName: "Adrián", createdById: "u-adrian",
    installments: 3, isShared: true,
    shares: [{ debtorId: "u-pareja", debtorName: "Pareja", sharePct: 50, monthlyAmount: 500 }],
  },
  { id: "t2", concept: "Nómina", category: "NOMINA", amount: 20000, date: iso(1), type: "INCOME", accountId: "a-main", accountName: "Main account", creatorName: "Adrián", createdById: "u-adrian", installments: 1, isShared: false, shares: [] },
  { id: "t3", concept: "Gasolina", category: "TRANSPORTE", amount: 800, date: iso(Math.min(today.getDate(), 8)), type: "EXPENSE", accountId: "a-main", accountName: "Main account", creatorName: "Adrián", createdById: "u-adrian", installments: 1, isShared: false, shares: [] },
  { id: "t4", concept: "Cena juntos", category: "OCIO", amount: 1200, date: iso(Math.min(today.getDate(), 12)), type: "EXPENSE", accountId: "a-pareja", accountName: "Débito Pareja", creatorName: "Pareja", createdById: "u-pareja", installments: 1, isShared: true, shares: [{ debtorId: "u-adrian", debtorName: "Adrián", sharePct: 50, monthlyAmount: 600 }] },
  { id: "t5", concept: "Spotify familiar", category: "SUSCRIPCIONES", amount: 199, date: iso(Math.min(today.getDate(), 16)), type: "EXPENSE", accountId: "a-main", accountName: "Main account", creatorName: "Adrián", createdById: "u-adrian", installments: 1, isShared: false, shares: [] },
];

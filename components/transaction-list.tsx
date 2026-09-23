import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { parseCat } from "@/lib/categories";

export type TxRow = {
  id: string;
  concept: string;
  category: string;
  amount: number;
  date: string;
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
};

export function TransactionRow({ t }: { t: TxRow }) {
  const income = t.type === "INCOME";
  const transfer = t.type === "TRANSFER";
  const d = new Date(t.date);
  return (
    <li className="flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) p-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted) text-xl">
        {transfer ? <ArrowLeftRight className="size-5 text-(--primary)" /> : parseCat(t.category).emoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{t.concept}</p>
        <p className="truncate text-xs text-(--muted-foreground)">
          {d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} ·{" "}
          {transfer && t.transferToAccountName
            ? `${t.accountName} → ${t.transferToAccountName}`
            : `${t.accountName} · ${t.creatorName}`}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {t.installments > 1 && (
            <Badge variant="warning"><Repeat className="size-3" /> {t.installments} MSI</Badge>
          )}
          {t.isShared && <Badge>Compartido</Badge>}
          {transfer && (
            <Badge variant="secondary">
              {t.transferToAccountType === "CREDIT" ? "Pago tarjeta" : "Transferencia"}
            </Badge>
          )}
        </div>
      </div>
      <span className={`flex items-center gap-0.5 text-sm font-extrabold ${income ? "text-emerald-500" : ""}`}>
        {transfer ? <ArrowLeftRight className="size-4" /> : income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
        {transfer ? "" : income ? "+" : "−"}{formatMoney(t.amount)}
      </span>
    </li>
  );
}

export function TransactionList({ txs }: { txs: TxRow[] }) {
  if (!txs.length) {
    return <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">Sin movimientos en este periodo.</p>;
  }
  return (
    <ul className="space-y-2">
      {txs.map((t) => <TransactionRow key={t.id} t={t} />)}
    </ul>
  );
}

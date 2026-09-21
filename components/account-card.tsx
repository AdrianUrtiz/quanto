import { CreditCard, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";

export type AccountRow = {
  id: string;
  name: string;
  type: "DEBIT" | "CREDIT";
  owner: string;
  balance: number;
  creditLimit?: number;
  statementDay?: number;
  dueDay?: number;
  lastFour?: string;
  color: string;
};

export function AccountCard({ a }: { a: AccountRow }) {
  const credit = a.type === "CREDIT";
  const available = credit ? (a.creditLimit ?? 0) - a.balance : a.balance;
  const Icon = credit ? CreditCard : Landmark;
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) p-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-white" style={{ background: a.color }}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {a.name} {a.lastFour && <span className="text-(--muted-foreground)">· ·{a.lastFour}</span>}
        </p>
        <p className="text-xs text-(--muted-foreground)">{a.owner} · {credit ? "Crédito" : "Débito"}</p>
        {credit && a.statementDay && a.dueDay && (
          <div className="mt-1 flex gap-1">
            <Badge variant="secondary">Corte {a.statementDay}</Badge>
            <Badge variant="secondary">Pago {a.dueDay}</Badge>
          </div>
        )}
      </div>
      <div className="text-right">
        <p className="text-base font-extrabold">{formatMoney(credit ? a.balance : available)}</p>
        <p className="text-[11px] text-(--muted-foreground)">{credit ? `Disponible ${formatMoney(available)}` : "Saldo"}</p>
      </div>
    </div>
  );
}

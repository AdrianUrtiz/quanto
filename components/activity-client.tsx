"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ActivityChart } from "@/components/activity-chart";
import { Pills } from "@/components/pills";
import { TransactionList, type TxRow } from "@/components/transaction-list";
import { formatMoney } from "@/lib/utils";

export function ActivityClient({
  txs, daily, total, monthLabel, accountNames,
}: {
  txs: TxRow[];
  daily: { day: number; total: number }[];
  total: number;
  monthLabel: string;
  accountNames: string[];
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("gastos");
  const [scope, setScope] = useState("todas");
  const [account, setAccount] = useState("todas");

  const filtered = useMemo(() => {
    return txs.filter((t) => {
      if (kind === "gastos" && t.type !== "EXPENSE") return false;
      if (kind === "ingresos" && t.type !== "INCOME") return false;
      if (scope === "compartidas" && !t.isShared) return false;
      if (scope === "msi" && !(t.installments > 1)) return false;
      if (account !== "todas" && t.accountName !== account) return false;
      if (q && !`${t.concept} ${t.category}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [txs, q, kind, scope, account]);

  const shownTotal = useMemo(() => {
    const list = filtered.filter((t) => (kind === "ingresos" ? t.type === "INCOME" : t.type === "EXPENSE"));
    return list.reduce((a, t) => a + t.amount, 0);
  }, [filtered, kind]);

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-center justify-center">
        <span className="rounded-full bg-(--muted) px-4 py-1.5 text-xs font-semibold">{monthLabel} ▾</span>
      </div>
      <p className="text-center text-5xl font-extrabold tracking-tight">{formatMoney(shownTotal)}</p>

      <ActivityChart daily={daily} />

      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-full border border-(--border) bg-(--card) px-4 py-2.5">
          <Search className="size-4 text-(--muted-foreground)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            className="w-full bg-transparent text-sm outline-none placeholder:text-(--muted-foreground)"
          />
        </div>
        <Pills
          value={kind}
          onChange={setKind}
          options={[
            { value: "gastos", label: "Gastos" },
            { value: "ingresos", label: "Ingresos" },
            { value: "todos", label: "Todos" },
            { value: "mensual", label: "Mensual" },
          ]}
        />
        <Pills
          value={scope}
          onChange={setScope}
          options={[
            { value: "todas", label: "Todas las cuentas" },
            { value: "compartidas", label: "Compartidas" },
            { value: "msi", label: "A MSI" },
          ]}
        />
        {accountNames.length > 1 && (
          <Pills
            value={account}
            onChange={setAccount}
            options={[{ value: "todas", label: "Todas" }, ...accountNames.map((a) => ({ value: a, label: a }))]}
          />
        )}
      </div>

      <TransactionList txs={filtered} />
    </div>
  );
}

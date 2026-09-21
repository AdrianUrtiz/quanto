"use client";

import { useMemo, useState } from "react";
import { HandCoins } from "lucide-react";
import { DonutChart } from "@/components/donut-chart";
import { Pills } from "@/components/pills";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils";
import type { SettlementLine } from "@/lib/calculations";

export function ResumenClient({
  total, byCategory, settlement, monthLabel,
}: {
  total: number;
  byCategory: { label: string; value: number }[];
  settlement: SettlementLine[];
  monthLabel: string;
}) {
  const [kind, setKind] = useState("gastos");

  const shown = useMemo(() => {
    if (kind === "todos") return { total, byCategory };
    return { total, byCategory };
  }, [kind, total, byCategory]);

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-center justify-center">
        <span className="rounded-full bg-(--muted) px-4 py-1.5 text-xs font-semibold">{monthLabel} ▾</span>
      </div>

      <Pills
        value={kind}
        onChange={setKind}
        options={[
          { value: "gastos", label: "Gastos" },
          { value: "mensual", label: "Mensual" },
          { value: "todos", label: "Todas las cuentas" },
        ]}
      />

      <Card>
        <CardContent className="pt-5">
          <DonutChart total={shown.total} slices={shown.byCategory} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="size-4 text-(--primary)" /> Cuentas por liquidar entre pareja
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settlement.length === 0 && (
            <p className="text-sm text-(--muted-foreground)">Nada que liquidar este mes. 🎉</p>
          )}
          {settlement.map((s) => (
            <div key={`${s.debtorId}-${s.creditorId}`} className="rounded-2xl bg-(--muted)/60 p-3.5">
              <p className="text-sm">
                <b>{s.debtorName}</b> aporta a <b>{s.creditorName}</b>
              </p>
              <p className="text-xl font-extrabold">{formatMoney(s.amount)}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-(--muted-foreground)">
                {s.details.map((d, i) => (
                  <li key={i}>· {d.concept} — {formatMoney(d.monthly)}/mes ({d.installment})</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

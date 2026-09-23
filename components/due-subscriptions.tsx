"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmSubscriptionCharge } from "@/lib/subscription-actions";
import { formatMoney } from "@/lib/utils";
import type { DueCharge } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

export function DueSubscriptions({ dues, compact }: { dues: DueCharge[]; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!dues.length) return null;

  async function confirm(d: DueCharge) {
    setBusy(`${d.id}:${d.monthKey}`);
    const res = await confirmSubscriptionCharge(d.id, d.monthKey);
    setBusy(null);
    if ("error" in res && res.error) toast.error(res.error);
    else toast.success(`${d.name} confirmado`);
  }

  return (
    <div className={cn("space-y-2", !compact && "px-5 pt-4")}>
      {!compact && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-(--muted-foreground)">
          <BellRing className="size-3.5" /> Cargos pendientes por confirmar
        </p>
      )}
      {dues.map((d) => {
        const key = `${d.id}:${d.monthKey}`;
        const loading = busy === key;
        return (
          <div
            key={key}
            className="flex items-center gap-3 rounded-3xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-xl">
              🔁
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                {d.name}{" "}
                {d.overdue && (
                  <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-500">
                    Vencido
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-(--muted-foreground)">
                {d.monthLabel} · {d.accountName}
                {d.monthlyShare != null && ` · pareja ${formatMoney(d.monthlyShare)}`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-extrabold">{formatMoney(d.amount)}</p>
              <Button
                size="sm"
                className="mt-1 h-8 rounded-full px-3 text-xs"
                disabled={loading}
                onClick={() => confirm(d)}
              >
                {loading ? (
                  "Guardando…"
                ) : (
                  <>
                    <Check className="size-3.5" /> Confirmar
                  </>
                )}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}


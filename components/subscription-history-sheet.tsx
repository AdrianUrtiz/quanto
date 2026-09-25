"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  confirmSubscriptionCharge,
  skipSubscriptionCharge,
  unskipSubscriptionCharge,
} from "@/lib/subscription-actions";
import { chargeDate, monthKeyOf, monthLabelOf } from "@/lib/subscriptions";
import { formatMoney } from "@/lib/utils";
import type { SubRow } from "@/components/subscription-tab";
import { cn } from "@/lib/utils";

/**
 * Historial mensual de una suscripción (últimos 6 meses, reciente primero).
 * Filas homologadas compactas: tarjeta punteada para "sin cobro",
 * y tarjeta sobria para confirmados y pendientes/vencidos.
 * Solo el dueño acciona sus cargos.
 */
export function SubscriptionHistorySheet({ sub }: { sub: SubRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const now = new Date();
  const curKey = monthKeyOf(now.getFullYear(), now.getMonth());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthlyShare = sub.isShared
    ? (sub.shareAmount ?? (sub.amount * sub.sharePct) / 100)
    : null;

  async function run(key: string, kind: "confirm" | "skip" | "unskip", fn: () => Promise<{ error?: string } | { ok: boolean }>, okMsg: string) {
    setBusy(`${key}:${kind}`);
    const res = await fn();
    setBusy(null);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success(okMsg);
      router.refresh();
    }
  }

  const months = [...sub.history].reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="flex items-center justify-center gap-1.5 text-sm font-bold">
          <History className="size-4 text-(--muted-foreground)" /> {sub.name}
        </p>
        <p className="text-xs text-(--muted-foreground)">
          Día {sub.chargeDay} · {sub.accountName} · {formatMoney(sub.amount)}/mes
        </p>
      </div>

      <ul className="space-y-2">
        {months.map((h) => {
          const waitingPartner = h.confirmed && h.isShared && !h.partnerPaid;
          const overdue = !h.confirmed && !h.skipped && h.monthKey < curKey;
          // Mes pendiente accionable: vencidos siempre; en curso desde su fecha de cobro.
          let actionable = overdue;
          if (!h.confirmed && !h.skipped && h.monthKey === curKey) {
            const d = chargeDate(h.monthKey, sub.chargeDay);
            actionable = new Date(d.getFullYear(), d.getMonth(), d.getDate()) <= today;
          }
          const loadingConfirm = busy === `${h.monthKey}:confirm`;
          const loadingSkip = busy === `${h.monthKey}:skip`;
          const loadingUnskip = busy === `${h.monthKey}:unskip`;
          const label = monthLabelOf(h.monthKey);

          if (h.skipped) {
            return (
              <li
                key={h.monthKey}
                className="flex items-center gap-3 rounded-3xl border border-dashed border-(--border) bg-(--muted)/40 px-3.5 py-2.5"
              >
                <p className="min-w-0 flex-1 truncate text-xs text-(--muted-foreground)">
                  <span className="font-semibold text-(--foreground)">{sub.name}</span> · sin cobro en {label}
                </p>
                {sub.isMine && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 rounded-full text-xs"
                    disabled={loadingUnskip}
                    onClick={() => run(h.monthKey, "unskip", () => unskipSubscriptionCharge(sub.id, h.monthKey), "Vuelve a pendientes")}
                  >
                    {loadingUnskip ? "…" : "Deshacer"}
                  </Button>
                )}
              </li>
            );
          }

          if (!h.confirmed) {
            return (
              <li
                key={h.monthKey}
                className="flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) px-3.5 py-2.5"
              >
                <p className="min-w-0 flex-1 truncate text-xs text-(--muted-foreground)">
                  <span className="font-semibold text-(--foreground)">{sub.name}</span> · {label}{" "}
                  {overdue && (
                    <span className="ml-1 inline-flex rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-500">
                      Vencido
                    </span>
                  )}
                </p>
                {actionable ? (
                  sub.isMine ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={loadingConfirm || loadingSkip}
                        onClick={() => run(h.monthKey, "confirm", () => confirmSubscriptionCharge(sub.id, h.monthKey), `${sub.name} confirmado`)}
                      >
                        {loadingConfirm ? "…" : "Confirmar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-full px-2.5 text-xs text-(--muted-foreground) hover:text-(--foreground)"
                        disabled={loadingConfirm || loadingSkip}
                        onClick={() => run(h.monthKey, "skip", () => skipSubscriptionCharge(sub.id, h.monthKey), "Marcado como no cobrado")}
                      >
                        {loadingSkip ? "…" : "No se cobró"}
                      </Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-[11px] text-(--muted-foreground)">
                      Lo confirma {sub.ownerName}
                    </span>
                  )
                ) : (
                  <span className="shrink-0 text-[11px] text-(--muted-foreground)">
                    Llega el día {sub.chargeDay}
                  </span>
                )}
              </li>
            );
          }

          return (
            <li
              key={h.monthKey}
              className="flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) px-3.5 py-4"
            >
              <p className="min-w-0 flex-1 truncate text-xs text-(--muted-foreground)">
                <span className="font-semibold text-(--foreground)">{sub.name}</span> · {label}
                {waitingPartner && (
                  <span className="block text-[11px]">
                    {sub.isMine
                      ? `${sub.partnerName ?? "Tu pareja"} te debe ${formatMoney(monthlyShare ?? 0)}`
                      : `Le debes a ${sub.ownerName} ${formatMoney(monthlyShare ?? 0)}`}
                  </span>
                )}
              </p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  waitingPartner ? "bg-amber-500/15 text-amber-600" : "bg-emerald-500/15 text-emerald-500",
                )}
              >
                {waitingPartner ? "Por cobrar" : "Confirmado"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmSubscriptionCharge, skipSubscriptionCharge } from "@/lib/subscription-actions";
import { formatMoney } from "@/lib/utils";
import type { DueCharge } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

export function DueSubscriptions({ dues, compact }: { dues: DueCharge[]; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (!dues.length) return null;

  async function confirm(d: DueCharge) {
    const k = `${d.id}:${d.monthKey}:confirm`;
    setBusy(k);
    const res = await confirmSubscriptionCharge(d.id, d.monthKey);
    setBusy(null);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success(`${d.name} confirmado`);
      router.refresh();
    }
  }

  async function skip(d: DueCharge) {
    const k = `${d.id}:${d.monthKey}:skip`;
    setBusy(k);
    const res = await skipSubscriptionCharge(d.id, d.monthKey);
    setBusy(null);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success(`${d.name}: sin cobro en ${d.monthLabel}`);
      router.refresh();
    }
  }

  return (
    <div className={cn("space-y-2", !compact && "px-5 pt-4")}>
      {!compact && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-(--muted-foreground)">
          <BellRing className="size-3.5" /> Suscripciones pendientes
        </p>
      )}
      {dues.map((d) => {
        const loadingConfirm = busy === `${d.id}:${d.monthKey}:confirm`;
        const loadingSkip = busy === `${d.id}:${d.monthKey}:skip`;
        // Etiqueta informativa: en las mías me pagan a mí,
        // en las suyas yo le pago a la dueña. El pago se registra en Pareja.
        const awaitingLabel = d.isMine
          ? d.partnerName
            ? `${d.partnerName} te debe ${formatMoney(d.monthlyShare ?? 0)}`
            : "Por cobrar"
          : `Le debes a ${d.ownerName} ${formatMoney(d.monthlyShare ?? 0)}`;
        const refAmount = d.monthlyShare;
        return (
          <div
            key={`${d.id}:${d.monthKey}`}
            className="space-y-2 rounded-3xl border border-amber-500/30 bg-amber-500/[0.07] p-3.5"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {d.isMine ? d.name : `${d.name} · de ${d.ownerName}`}{" "}
                  {d.overdue && (
                    <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-500">
                      {d.confirmed ? "Por cobrar" : "Vencido"}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-(--muted-foreground)">
                  {d.monthLabel} · {d.accountName}
                  {d.isShared && d.monthlyShare != null && ` · su parte ${formatMoney(d.monthlyShare)}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-extrabold">{formatMoney(d.amount)}</p>
                {!d.isMine && (
                  <p className="text-[11px] text-(--muted-foreground)">cargo en su tarjeta</p>
                )}
              </div>
            </div>

            {!d.confirmed ? (
              d.isMine ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-9 flex-1 rounded-full text-xs"
                    disabled={loadingConfirm || loadingSkip}
                    onClick={() => confirm(d)}
                  >
                    {loadingConfirm ? "Guardando…" : `Confirmar cobro · ${formatMoney(d.amount)}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-9 rounded-full text-xs"
                    disabled={loadingConfirm || loadingSkip}
                    onClick={() => skip(d)}
                  >
                    {loadingSkip ? "Guardando…" : "No se cobró"}
                  </Button>
                </div>
              ) : (
                <p className="text-center text-[11px] text-(--muted-foreground)">
                  Lo confirma {d.ownerName} en su sesión
                </p>
              )
            ) : (
              <p className="rounded-2xl bg-(--muted)/60 px-3.5 py-2.5 text-center text-xs font-semibold">
                {awaitingLabel}
                <span className="block text-[11px] font-normal text-(--muted-foreground)">
                  Se marca solo al liquidar en Pareja
                </span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/bottom-sheet";
import { Button } from "@/components/ui/button";
import { confirmPaymentSource } from "@/lib/payment-actions";
import type { SourceConfirmItem } from "@/components/cuentas-client";
import type { AccountOpt } from "@/components/transaction-form";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Banner de cobros que el acreedor dice recibidos y esperan que yo indique
 * de qué cuenta salió. Aparece en Actividad (como PendingPaymentsBanner).
 */
export function SourceConfirmBanner({
  items,
  accountOptions,
  compact,
}: {
  items: SourceConfirmItem[];
  accountOptions: AccountOpt[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<SourceConfirmItem | null>(null);
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!items.length) return null;

  async function confirm() {
    if (!target) return;
    if (!accountId) {
      setMsg("Elige de qué cuenta salió");
      return;
    }
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    fd.set("paymentId", target.id);
    fd.set("accountId", accountId);
    const res = await confirmPaymentSource(fd);
    setPending(false);
    if ("error" in res && res.error) {
      setMsg(res.error);
      toast.error(res.error);
    } else {
      toast.success("Origen confirmado");
      setTarget(null);
      router.refresh();
    }
  }

  return (
    <div className={cn("space-y-2", !compact && "px-5 pt-4")}>
      {!compact && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-(--muted-foreground)">
          <BellRing className="size-3.5" /> Confirma de qué cuenta salió
        </p>
      )}
      {items.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            setMsg(null);
            setTarget(p);
          }}
          className="flex w-full items-center gap-3 rounded-3xl border border-sky-500/30 bg-sky-500/[0.07] p-3.5 text-left transition active:scale-[.99]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15">
            <ArrowUpRight className="size-5 text-sky-500" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {p.concept} · {p.monthLabel}
            </span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              {p.creditorName} dice que le pagaste · ¿de qué cuenta salió?
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-base font-extrabold">{formatMoney(p.amount)}</span>
            <span className="block text-[11px] font-semibold text-sky-500">Indicar ›</span>
          </span>
        </button>
      ))}

      <BottomSheet open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        {target && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
            <div className="space-y-1 text-center">
              <p className="text-sm font-bold">{target.concept} · {target.monthLabel}</p>
              <p className="text-xs text-(--muted-foreground)">
                {target.creditorName} registró que le pagaste{" "}
                <b className="text-(--foreground)">{formatMoney(target.amount)}</b>.
                Elige de qué cuenta salió para reflejar tu egreso.
              </p>
            </div>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {accountOptions.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setAccountId(a.id)}
                    className={`flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted) ${accountId === a.id ? "bg-(--muted)" : ""}`}
                  >
                    <span className="flex-1 text-sm font-semibold">{a.name}</span>
                    {accountId === a.id && <Check className="size-4 text-(--primary)" />}
                  </button>
                </li>
              ))}
            </ul>
            {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
            <Button
              type="button"
              className="h-12 w-full rounded-2xl text-base"
              disabled={pending || !accountId}
              onClick={confirm}
            >
              {pending ? "Guardando…" : "Confirmar origen"}
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

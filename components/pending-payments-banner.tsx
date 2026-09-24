"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, HandCoins } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { PaymentSheet } from "@/components/payment-sheet";
import type { ToConfirmItem } from "@/components/cuentas-client";
import type { AccountOpt } from "@/components/transaction-form";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Banner de pagos de pareja pendientes de mi confirmación.
 * Aparece en Actividad (como DueSubscriptions) y lleva al mismo
 * sheet de confirmación con cuenta destino.
 */
export function PendingPaymentsBanner({
  items,
  accountOptions,
  compact,
}: {
  items: ToConfirmItem[];
  accountOptions: AccountOpt[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ToConfirmItem | null>(null);

  if (!items.length) return null;

  return (
    <div className={cn("space-y-2", !compact && "px-5 pt-4")}>
      {!compact && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-(--muted-foreground)">
          <BellRing className="size-3.5" /> Pagos por confirmar
        </p>
      )}
      {items.map((p) => (
        <button
          key={p.id}
          onClick={() => setTarget(p)}
          className="flex w-full items-center gap-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.07] p-3.5 text-left transition active:scale-[.99]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15">
            <HandCoins className="size-5 text-emerald-500" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {p.concept} · {p.monthLabel}
            </span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              {p.registeredByName} dice que te pagó
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-base font-extrabold">{formatMoney(p.amount)}</span>
            <span className="block text-[11px] font-semibold text-emerald-500">Revisar ›</span>
          </span>
        </button>
      ))}

      <BottomSheet open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        {target && (
          <PaymentSheet
            key={target.id}
            mode="confirm"
            payment={target}
            accountOptions={accountOptions}
            onDone={() => {
              setTarget(null);
              router.refresh();
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}

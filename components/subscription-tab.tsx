"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BottomSheet } from "@/components/bottom-sheet";
import { SubscriptionForm, type SubEditData } from "@/components/subscription-form";
import { SubscriptionPaySheet } from "@/components/subscription-pay-sheet";
import type { AccountRow } from "@/components/account-card";
import { DueSubscriptions } from "@/components/due-subscriptions";
import { SubscriptionSwipeRow } from "@/components/subscription-swipe-row";
import { deleteSubscription, toggleSubscription } from "@/lib/subscription-actions";
import { formatMoney } from "@/lib/utils";
import type { AccountOpt } from "@/components/transaction-form";
import type { DueCharge } from "@/lib/subscriptions";
import type { CatalogRow } from "@/lib/catalog";

export type SubRow = SubEditData & {
  accountName: string;
  isActive: boolean;
};

/** Estado de pago de una suscripción para el mes relevante. */
export type SubPayState = {
  subId: string;
  month: string; // "YYYY-MM" (cargo pendiente o mes actual)
  monthLabel: string;
  chargeConfirmed: boolean;
  shareId: string | null;
  monthly: number; // parte de la pareja ese mes (0 si es solo mía)
  paid: number; // suma CONFIRMED de su parte
  pending: number; // suma PENDING de su parte
  accountType: "DEBIT" | "CREDIT"; // cuenta donde cae el cargo
};

export function SubscriptionTab({
  subs, dues, accountOptions, cats, payStates = [], accounts = [],
}: {
  subs: SubRow[];
  dues: DueCharge[];
  accountOptions: AccountOpt[];
  cats: CatalogRow[];
  payStates?: SubPayState[];
  accounts?: AccountRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SubRow | null>(null);
  const [deleting, setDeleting] = useState<SubRow | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ s: SubRow; state: SubPayState } | null>(null);
  const [busy, setBusy] = useState(false);

  const monthly = subs.filter((s) => s.isActive).reduce((a, s) => a + s.amount, 0);

  async function toggle(s: SubRow) {
    setBusy(true);
    const res = await toggleSubscription(s.id, !s.isActive);
    setBusy(false);
    if ("error" in res && res.error) toast.error(res.error);
    else toast.success(s.isActive ? `${s.name} pausada` : `${s.name} reanudada`);
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const res = await deleteSubscription(deleting.id);
    setBusy(false);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success("Suscripción eliminada");
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <DueSubscriptions dues={dues} compact />

      <div className="space-y-2">
        {subs.length === 0 && (
          <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
            Sin suscripciones. Agrega Netflix, Spotify, gimnasio…
          </p>
        )}
        {subs.map((s) => (
          <SubscriptionSwipeRow
            key={s.id}
            s={s}
            cats={cats}
            open={openRow === s.id}
            onOpenChange={(o) => setOpenRow(o ? s.id : null)}
            onToggle={() => !busy && toggle(s)}
            onEdit={() => setEditing(s)}
            onDelete={() => setDeleting(s)}
            pay={payStates.find((p) => p.subId === s.id)}
            onPay={() => {
              const st = payStates.find((p) => p.subId === s.id);
              if (st) setPaying({ s, state: st });
            }}
          />
        ))}
      </div>

      <p className="text-center text-[11px] text-(--muted-foreground)">
        {formatMoney(monthly)}/mes en {subs.filter((s) => s.isActive).length} activas
      </p>

      <BottomSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
          {editing && (
            <SubscriptionForm
              subscription={editing}
              accountOptions={accountOptions}
              cats={cats}
              onDone={() => setEditing(null)}
            />
          )}
      </BottomSheet>

      <BottomSheet open={paying !== null} onOpenChange={(o) => !o && setPaying(null)}>
        {paying && (
          <SubscriptionPaySheet
            key={`${paying.s.id}:${paying.state.month}`}
            sub={paying.s}
            state={paying.state}
            accountOptions={accountOptions}
            targetAccount={accounts.find((a) => a.id === paying.s.accountId)}
            onDone={() => {
              setPaying(null);
              router.refresh();
            }}
          />
        )}
      </BottomSheet>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Los cargos ya confirmados se conservan como movimientos normales.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
              {busy ? "Eliminando…" : "Sí, eliminar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

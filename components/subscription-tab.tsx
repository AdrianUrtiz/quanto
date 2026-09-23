"use client";

import { useState } from "react";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SubscriptionForm, type SubEditData } from "@/components/subscription-form";
import { DueSubscriptions } from "@/components/due-subscriptions";
import { deleteSubscription, toggleSubscription } from "@/lib/subscription-actions";
import { formatMoney } from "@/lib/utils";
import { parseCat } from "@/lib/categories";
import type { AccountOpt } from "@/components/transaction-form";
import type { DueCharge } from "@/lib/subscriptions";

export type SubRow = SubEditData & {
  accountName: string;
  isActive: boolean;
};

export function SubscriptionTab({
  subs, dues, accountOptions,
}: {
  subs: SubRow[];
  dues: DueCharge[];
  accountOptions: AccountOpt[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SubRow | null>(null);
  const [deleting, setDeleting] = useState<SubRow | null>(null);
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
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-(--muted-foreground)">Comprometido/mes</p>
          <p className="text-4xl font-extrabold tracking-tight">{formatMoney(monthly)}</p>
        </div>
        <Button size="icon" aria-label="Agregar suscripción" className="rounded-full" onClick={() => setAddOpen(true)}>
          <Plus className="size-5" />
        </Button>
      </div>

      <DueSubscriptions dues={dues} compact />

      <div className="space-y-2">
        {subs.length === 0 && (
          <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
            Sin suscripciones. Agrega Netflix, Spotify, gimnasio…
          </p>
        )}
        {subs.map((s) => {
          const cat = parseCat(s.category);
          return (
            <div
              key={s.id}
              className={`flex items-center gap-3 rounded-3xl border p-3.5 ${
                s.isActive ? "border-(--border) bg-(--card)" : "border-dashed border-(--border) bg-(--muted)/40 opacity-70"
              }`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted) text-xl">
                {cat.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {s.name}{" "}
                  {!s.isActive && (
                    <Badge variant="secondary">Pausada</Badge>
                  )}
                </p>
                <p className="truncate text-xs text-(--muted-foreground)">
                  Día {s.chargeDay} · {s.accountName}
                  {s.isShared && (
                    <> · comparte {s.shareAmount ?? `${s.sharePct}%`}</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  aria-label={s.isActive ? "Pausar" : "Reanudar"}
                  disabled={busy}
                  onClick={() => toggle(s)}
                  className="rounded-full p-2 text-(--muted-foreground) hover:bg-(--muted) hover:text-(--foreground)"
                >
                  {s.isActive ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <button
                  aria-label="Editar"
                  onClick={() => setEditing(s)}
                  className="rounded-full p-2 text-(--muted-foreground) hover:bg-(--muted) hover:text-(--foreground)"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  aria-label="Eliminar"
                  onClick={() => setDeleting(s)}
                  className="rounded-full p-2 text-(--muted-foreground) hover:bg-(--muted) hover:text-red-500"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-(--muted-foreground)">
        {formatMoney(monthly)}/mes en {subs.filter((s) => s.isActive).length} activas
      </p>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva suscripción</DialogTitle>
          </DialogHeader>
          <SubscriptionForm accountOptions={accountOptions} onDone={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar suscripción</DialogTitle>
          </DialogHeader>
          {editing && (
            <SubscriptionForm
              subscription={editing}
              accountOptions={accountOptions}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

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

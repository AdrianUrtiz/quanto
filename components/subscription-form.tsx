"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createSubscription, updateSubscription } from "@/lib/subscription-actions";
import { DEFAULT_CATS, parseCat } from "@/lib/categories";
import type { AccountOpt } from "@/components/transaction-form";
import { cn } from "@/lib/utils";

export type SubEditData = {
  id: string;
  name: string;
  amount: number;
  category: string;
  accountId: string;
  chargeDay: number;
  isShared: boolean;
  sharePct: number;
  shareAmount: number | null;
};

const EXPENSE_CATS = DEFAULT_CATS.filter((c) => c.kind !== "income");

export function SubscriptionForm({
  subscription, accountOptions, onDone,
}: {
  subscription?: SubEditData;
  accountOptions: AccountOpt[];
  onDone?: () => void;
}) {
  const editing = Boolean(subscription);
  const [shared, setShared] = useState(subscription?.isShared ?? false);
  const [shareMode, setShareMode] = useState<"pct" | "amount">(
    subscription?.shareAmount != null ? "amount" : "pct",
  );
  const [sharePct, setSharePct] = useState(subscription?.sharePct ?? 50);
  const [amount, setAmount] = useState(subscription ? String(subscription.amount) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const totalNum = Number(amount) || 0;
  const preview = shareMode === "pct" ? (totalNum * sharePct) / 100 : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    // Si el switch está apagado, el checkbox no se envía → explícito.
    if (!shared) fd.set("isShared", "false");
    if (shared && shareMode === "amount") fd.delete("sharePct");
    if (shared && shareMode === "pct") fd.delete("shareAmount");
    const res = editing ? await updateSubscription(fd) : await createSubscription(fd);
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {editing && <input type="hidden" name="id" value={subscription!.id} />}

      <div className="space-y-1.5">
        <Label htmlFor="sub-name">Nombre</Label>
        <Input
          id="sub-name"
          name="name"
          defaultValue={subscription?.name}
          placeholder="Spotify, Netflix, gimnasio…"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sub-amount">Monto (MXN)</Label>
          <Input
            id="sub-amount"
            name="amount"
            type="number"
            min={0.01}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="199"
            required
            inputMode="decimal"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-day">Día de cobro</Label>
          <Input
            id="sub-day"
            name="chargeDay"
            type="number"
            min={1}
            max={31}
            defaultValue={subscription?.chargeDay ?? new Date().getDate()}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sub-cat">Categoría</Label>
          <select
            id="sub-cat"
            name="category"
            defaultValue={subscription?.category ?? "SUSCRIPCIONES"}
            className="flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-3 text-sm"
          >
            {EXPENSE_CATS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sub-acc">Cuenta de cargo</Label>
          <select
            id="sub-acc"
            name="accountId"
            required
            defaultValue={subscription?.accountId ?? accountOptions[0]?.id ?? ""}
            className="flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-3 text-sm"
          >
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {subscription && (
        <p className="text-xs text-(--muted-foreground)">
          Categoría actual: {parseCat(subscription.category).emoji} {parseCat(subscription.category).label}
        </p>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-(--border) p-3.5">
        <div>
          <p className="text-sm font-semibold">Compartir con mi pareja</p>
          <p className="text-xs text-(--muted-foreground)">Cada cargo mensual genera su split</p>
        </div>
        <Switch checked={shared} onCheckedChange={setShared} name="isShared" aria-label="Compartir suscripción" />
      </div>

      {shared && (
        <div className="space-y-3 rounded-3xl border border-(--border) p-4">
          <div className="mx-auto grid w-fit grid-cols-2 gap-2 rounded-full bg-(--muted) p-1">
            {(["pct", "amount"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setShareMode(m)}
                className={cn(
                  "rounded-full px-5 py-1.5 text-xs font-semibold",
                  shareMode === m ? "bg-(--card) shadow" : "text-(--muted-foreground)",
                )}
              >
                {m === "pct" ? "Porcentaje" : "Cantidad"}
              </button>
            ))}
          </div>
          {shareMode === "pct" ? (
            <>
              <p className="text-center text-3xl font-extrabold tabular-nums">{sharePct}%</p>
              <input
                type="range"
                min={1}
                max={99}
                name="sharePct"
                value={sharePct}
                onChange={(e) => setSharePct(Number(e.target.value))}
                aria-label="Porcentaje que aporta tu pareja"
                className="w-full accent-(--primary)"
              />
              <p className="text-center text-xs text-(--muted-foreground)">
                Tu pareja aporta <b>${preview?.toFixed(2) ?? "0.00"}/mes</b>
              </p>
            </>
          ) : (
            <>
              <Label htmlFor="sub-share-amt">Aportación fija de tu pareja (total)</Label>
              <Input
                id="sub-share-amt"
                name="shareAmount"
                type="number"
                min={0.01}
                step={0.01}
                defaultValue={subscription?.shareAmount ?? ""}
                placeholder="99"
                inputMode="decimal"
              />
            </>
          )}
        </div>
      )}

      {msg && <p className="text-sm font-medium text-red-500">{msg}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear suscripción"}
      </Button>
    </form>
  );
}

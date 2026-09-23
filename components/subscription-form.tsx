"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createSubscription, updateSubscription } from "@/lib/subscription-actions";
import { DEFAULT_CATS } from "@/lib/categories";
import type { AccountOpt } from "@/components/transaction-form";
import { formatMoney } from "@/lib/utils";
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
  const [name, setName] = useState(subscription?.name ?? "");
  const [amount, setAmount] = useState(subscription ? String(subscription.amount) : "");
  const [day, setDay] = useState(subscription?.chargeDay ?? new Date().getDate());
  const [accountId, setAccountId] = useState(subscription?.accountId ?? accountOptions[0]?.id ?? "");
  const [category, setCategory] = useState(subscription?.category ?? "SUSCRIPCIONES");
  const [shared, setShared] = useState(subscription?.isShared ?? false);
  const [shareMode, setShareMode] = useState<"pct" | "amount">(
    subscription?.shareAmount != null ? "amount" : "pct",
  );
  const [sharePct, setSharePct] = useState(subscription?.sharePct ?? 50);
  const [shareAmt, setShareAmt] = useState(
    subscription?.shareAmount != null ? String(subscription.shareAmount) : "",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const totalNum = Number(amount) || 0;
  const preview = shareMode === "pct" ? (totalNum * sharePct) / 100 : Number(shareAmt) || 0;
  const accountName = accountOptions.find((a) => a.id === accountId)?.name ?? "Cuenta";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!totalNum || totalNum <= 0) {
      setMsg("Ingresa el monto mensual");
      return;
    }
    if (!name.trim()) {
      setMsg("Ponle un nombre");
      return;
    }
    if (!accountId) {
      setMsg("Elige la cuenta de cargo");
      return;
    }
    if (shared && shareMode === "amount") {
      const v = Number(shareAmt);
      if (!shareAmt || Number.isNaN(v) || v <= 0 || v >= totalNum) {
        setMsg("La aportación debe ser mayor a 0 y menor al total");
        return;
      }
    }
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    if (editing) fd.set("id", subscription!.id);
    fd.set("name", name.trim());
    fd.set("amount", String(totalNum));
    fd.set("chargeDay", String(day));
    fd.set("category", category);
    fd.set("accountId", accountId);
    fd.set("isShared", shared ? "true" : "false");
    if (shared) {
      if (shareMode === "pct") fd.set("sharePct", String(sharePct));
      else fd.set("shareAmount", shareAmt);
    }
    const res = editing ? await updateSubscription(fd) : await createSubscription(fd);
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      {editing && <input type="hidden" name="id" value={subscription!.id} />}

      {/* Monto mensual */}
      <div className="flex items-center justify-center gap-1.5 pt-1">
        <span className="text-2xl font-bold text-(--muted-foreground)">$</span>
        <input
          value={amount}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, "");
            if (v.split(".").length > 2) return;
            const [, dec] = v.split(".");
            if (dec !== undefined && dec.length > 2) return;
            setAmount(v);
          }}
          placeholder="0"
          inputMode="decimal"
          aria-label="Monto mensual"
          className="w-44 bg-transparent text-center text-5xl font-extrabold tabular-nums outline-none placeholder:text-(--muted-foreground)/40"
        />
      </div>
      <p className="-mt-3 text-center text-xs font-medium text-(--muted-foreground)">al mes</p>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Spotify, Netflix, gimnasio…"
        maxLength={60}
        aria-label="Nombre"
        className="h-12 text-base"
      />

      {/* Pills: día · cuenta · categoría */}
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <DayPill day={day} onPick={setDay} />
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="Cuenta de cargo"
          className="max-w-[200px] shrink-0 truncate appearance-none rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold outline-none"
        >
          {accountOptions.length === 0 && <option value="">Sin cuentas</option>}
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Categorías slider */}
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {EXPENSE_CATS.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setCategory(c.code)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold",
              category === c.code
                ? "border-transparent bg-(--foreground) text-(--background)"
                : "border-(--border) bg-(--muted)/60",
            )}
          >
            <c.icon className="size-4 shrink-0" style={{ color: c.color }} /> {c.label}
          </button>
        ))}
      </div>

      {/* Compartir */}
      <div className="flex items-center justify-between rounded-2xl border border-(--border) px-4 py-2.5">
        <div>
          <p className="text-xs font-semibold">Compartir con mi pareja</p>
          <p className="text-[11px] text-(--muted-foreground)">Cada cargo genera su split</p>
        </div>
        <Switch checked={shared} onCheckedChange={setShared} aria-label="Compartir suscripción" />
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
                value={sharePct}
                onChange={(e) => setSharePct(Number(e.target.value))}
                aria-label="Porcentaje que aporta tu pareja"
                className="w-full accent-(--primary)"
              />
            </>
          ) : (
            <Input
              type="number"
              min={0.01}
              step={0.01}
              value={shareAmt}
              onChange={(e) => setShareAmt(e.target.value)}
              placeholder="Aportación fija ($)"
              inputMode="decimal"
            />
          )}
          <p className="text-center text-xs text-(--muted-foreground)">
            Tu pareja aporta <b>{formatMoney(preview)}/mes</b>
          </p>
        </div>
      )}

      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
      <Button type="submit" className="h-12 w-full rounded-2xl text-base" disabled={pending}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear suscripción"}
      </Button>
    </form>
  );
}

function DayPill({ day, onPick }: { day: number; onPick: (d: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
      >
        <Repeat className="size-3.5" /> Día {day}
      </button>
      {open && (
        <div className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                onPick(d);
                setOpen(false);
              }}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                day === d
                  ? "border-transparent bg-(--foreground) text-(--background)"
                  : "border-(--border) text-(--muted-foreground)",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

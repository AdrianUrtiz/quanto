"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmPayment,
  registerPayment,
  rejectPayment,
} from "@/lib/payment-actions";
import type { AccountOpt } from "@/components/transaction-form";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

export type PayLine = {
  shareId: string;
  concept: string;
  installment: number;
  installments: number;
  month: string;
  monthly: number;
  paid: number;
  pending: number;
};

export type ConfirmTarget = {
  id: string;
  amount: number;
  concept: string;
  monthLabel: string;
  monthly: number;
  registeredByName: string;
};

export function lineRemaining(l: PayLine): number {
  return Math.max(0, l.monthly - l.paid);
}

/**
 * Sheet para abonos de pareja.
 * - receive: "me pagó" → CONFIRMED + ingreso en mi cuenta (la elijo aquí).
 * - pay: "le pagué" → PENDING + egreso opcional en mi cuenta.
 * - confirm: confirmo lo que registró mi pareja → ingreso en mi cuenta.
 */
export function PaymentSheet({
  mode,
  lines = [],
  payment,
  accountOptions,
  onDone,
}: {
  mode: "receive" | "pay" | "confirm";
  lines?: PayLine[];
  payment?: ConfirmTarget;
  accountOptions: AccountOpt[];
  onDone?: () => void;
}) {
  const firstOpen = lines.find((l) => lineRemaining(l) > 0) ?? lines[0];
  const [selId, setSelId] = useState(firstOpen?.shareId ?? "");
  const sel = lines.find((l) => l.shareId === selId) ?? firstOpen;
  const [amount, setAmount] = useState(
    sel ? String(Math.round(lineRemaining(sel) * 100) / 100) : "",
  );
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "");
  const [noMovement, setNoMovement] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function pick(line: PayLine) {
    setSelId(line.shareId);
    setAmount(String(Math.round(lineRemaining(line) * 100) / 100));
    setMsg(null);
  }

  async function submit() {
    if (mode === "confirm" && !payment) return;
    if (mode !== "confirm" && !sel) return;
    setMsg(null);
    setPending(true);
    let res;
    if (mode === "confirm") {
      const fd = new FormData();
      fd.set("paymentId", payment!.id);
      fd.set("accountId", accountId);
      res = await confirmPayment(fd);
    } else {
      const fd = new FormData();
      fd.set("shareId", sel.shareId);
      fd.set("month", sel.month);
      fd.set("amount", amount);
      if (mode === "receive" || !noMovement) fd.set("accountId", accountId);
      res = await registerPayment(fd);
    }
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else {
      setMsg(null);
      onDone?.();
    }
  }

  async function reject() {
    if (!payment) return;
    setMsg(null);
    setPending(true);
    const res = await rejectPayment(payment.id);
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  const title =
    mode === "receive" ? "Registrar cobro" : mode === "pay" ? "Registrar pago" : "Confirmar pago";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <p className="text-center text-sm font-bold">{title}</p>

      {mode === "confirm" && payment ? (
        <div className="space-y-1 rounded-3xl border border-(--border) p-4 text-center">
          <p className="text-3xl font-extrabold tracking-tight">{formatMoney(payment.amount)}</p>
          <p className="text-xs font-medium text-(--muted-foreground)">
            {payment.concept} · {payment.monthLabel}
          </p>
          <p className="text-xs text-(--muted-foreground)">
            Lo registró <b className="text-(--foreground)">{payment.registeredByName}</b>
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lines.map((l) => {
            const rest = lineRemaining(l);
            const active = l.shareId === sel?.shareId;
            return (
              <li key={`${l.shareId}:${l.month}`}>
                <button
                  type="button"
                  onClick={() => pick(l)}
                  className={cn(
                    "w-full rounded-3xl border p-4 text-left transition active:scale-[.99]",
                    active ? "border-(--primary) bg-(--primary)/10" : "border-(--border)",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {l.concept}{" "}
                      <span className="font-medium text-(--muted-foreground)">
                        ({l.installments > 1 ? `${l.installment}/${l.installments}` : "único"})
                      </span>
                    </span>
                    {active && <Check className="size-4 shrink-0 text-(--primary)" />}
                  </span>
                  <span className="mt-1 block text-xs text-(--muted-foreground)">
                    {l.paid > 0 && <>Abonado {formatMoney(l.paid)} · </>}
                    {l.pending > 0 && <>Por confirmar {formatMoney(l.pending)} · </>}
                    <b className="text-(--foreground)">Restan {formatMoney(rest)}</b> de {formatMoney(l.monthly)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {mode !== "confirm" && (
        <div className="space-y-1.5">
          <Label htmlFor="pay-amount">Monto del abono</Label>
          <div className="flex items-center gap-1.5">
            <span className="text-xl font-bold text-(--muted-foreground)">$</span>
            <Input
              id="pay-amount"
              type="number"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 text-xl font-bold"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
        </div>
      )}

      {(mode === "receive" || mode === "confirm" || (mode === "pay" && !noMovement)) && (
        <div className="space-y-1.5">
          <Label>{mode === "pay" ? "Cuenta de origen" : "Cuenta donde recibiste"}</Label>
          {accountOptions.length === 0 ? (
            <p className="rounded-2xl bg-(--muted) px-4 py-3 text-center text-xs font-semibold text-(--muted-foreground)">
              Agrega una cuenta primero para reflejar el movimiento
            </p>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {accountOptions.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setAccountId(a.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)",
                      accountId === a.id && "bg-(--muted)",
                    )}
                  >
                    <span className="flex-1 text-sm font-semibold">{a.name}</span>
                    {accountId === a.id && <Check className="size-4 text-(--primary)" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === "pay" && (
        <button
          type="button"
          onClick={() => setNoMovement((v) => !v)}
          className={cn(
            "rounded-2xl border px-4 py-2.5 text-xs font-semibold transition",
            noMovement ? "border-(--primary) bg-(--primary)/10" : "border-(--border) text-(--muted-foreground)",
          )}
        >
          {noMovement ? "✓ Solo marcar, sin mover mi saldo" : "Mover mi saldo (crear egreso)"}
        </button>
      )}

      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
      <Button
        type="button"
        className="h-12 w-full rounded-2xl text-base"
        disabled={pending || (mode !== "confirm" && !sel) || ((mode === "receive" || mode === "confirm") && !accountId)}
        onClick={submit}
      >
        {pending ? "Guardando…" : mode === "confirm" ? "Confirmar y registrar ingreso" : mode === "receive" ? "Confirmar cobro" : "Registrar (queda por confirmar)"}
      </Button>
      {mode === "confirm" && (
        <button
          type="button"
          onClick={reject}
          disabled={pending}
          className="text-center text-sm font-semibold text-red-500 disabled:opacity-50"
        >
          Rechazar (no me llegó)
        </button>
      )}
      {mode === "receive" && (
        <p className="text-center text-[11px] text-(--muted-foreground)">
          Al registrarlo tú, queda confirmado y crea el ingreso al instante
        </p>
      )}
      {mode === "pay" && (
        <p className="text-center text-[11px] text-(--muted-foreground)">
          Tu pareja deberá confirmarlo en su app
        </p>
      )}
    </div>
  );
}

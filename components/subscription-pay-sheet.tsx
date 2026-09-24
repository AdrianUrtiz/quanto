"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmSubscriptionCharge,
  registerSubscriptionPayment,
} from "@/lib/subscription-actions";
import type { AccountOpt } from "@/components/transaction-form";
import type { AccountRow } from "@/components/account-card";
import { AccountMoneySheet } from "@/components/account-money-sheet";
import type { SubPayState, SubRow } from "@/components/subscription-tab";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Pagos de una suscripción (solo yo la gestiono → sin confirmación).
 * Confirmar = la plataforma me cobró (la deuda crece si es crédito).
 * Pagar tarjeta = yo saldo mi crédito con débito (solo cuentas CREDIT).
 * Cobro a pareja = ella me pagó su parte (ingreso en mi cuenta, admite abonos).
 */
export function SubscriptionPaySheet({
  sub,
  state,
  accountOptions,
  targetAccount,
  onDone,
}: {
  sub: SubRow;
  state: SubPayState;
  accountOptions: AccountOpt[];
  targetAccount?: AccountRow;
  onDone?: () => void;
}) {
  const remaining = Math.max(0, state.monthly - state.paid);
  const [amount, setAmount] = useState(
    String(Math.round((state.chargeConfirmed ? remaining : state.monthly) * 100) / 100),
  );
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(res: Promise<{ error?: string; ok?: boolean }>, okMsg: string) {
    setMsg(null);
    setPending(true);
    const r = await res;
    setPending(false);
    if ("error" in r && r.error) {
      setMsg(r.error);
      toast.error(r.error);
    } else {
      setMsg(null);
      toast.success(okMsg);
      onDone?.();
    }
  }

  function payMine() {
    if (sub.isShared) {
      const fd = new FormData();
      fd.set("subscriptionId", sub.id);
      fd.set("month", state.month);
      fd.set("who", "me");
      return run(registerSubscriptionPayment(fd), "Cargo confirmado");
    }
    return run(confirmSubscriptionCharge(sub.id, state.month), `${sub.name} pagada`);
  }

  function payPartner() {
    const fd = new FormData();
    fd.set("subscriptionId", sub.id);
    fd.set("month", state.month);
    fd.set("who", "partner");
    fd.set("amount", amount);
    fd.set("accountId", accountId);
    return run(registerSubscriptionPayment(fd), "Cobro registrado");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="text-sm font-bold">{sub.name}</p>
        <p className="text-xs text-(--muted-foreground)">
          {state.chargeConfirmed ? (
            <>Cargo de {state.monthLabel} confirmado ✓</>
          ) : (
            <>Cargo de {state.monthLabel} · <b className="text-(--foreground)">{formatMoney(sub.amount)}</b> a {sub.accountName}</>
          )}
        </p>
        {sub.isShared && state.chargeConfirmed && (
          <p className="text-xs text-(--muted-foreground)">
            Su parte: {state.paid > 0 && <>abonado {formatMoney(state.paid)} · </>}
            {state.pending > 0 && <>por confirmar {formatMoney(state.pending)} · </>}
            <b className="text-(--foreground)">restan {formatMoney(remaining)}</b> de {formatMoney(state.monthly)}
          </p>
        )}
      </div>

      {!state.chargeConfirmed && (
        <Button
          type="button"
          className="h-12 w-full rounded-2xl text-base"
          disabled={pending}
          onClick={payMine}
        >
          {pending ? "Guardando…" : sub.isShared ? `Pagué yo · ${formatMoney(sub.amount)}` : `Confirmar pago · ${formatMoney(sub.amount)}`}
        </Button>
      )}

      {sub.isShared && remaining > 0.005 && (
        <div className="space-y-3 rounded-3xl border border-(--border) p-4">
          <p className="text-center text-sm font-bold">Pagó mi pareja</p>
          <div className="space-y-1.5">
            <Label htmlFor="sub-pay-amount">Monto del cobro</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-bold text-(--muted-foreground)">$</span>
              <Input
                id="sub-pay-amount"
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
          <div className="space-y-1.5">
            <Label>Cuenta donde recibiste</Label>
            {accountOptions.length === 0 ? (
              <p className="rounded-2xl bg-(--muted) px-4 py-3 text-center text-xs font-semibold text-(--muted-foreground)">
                Agrega una cuenta primero para reflejar el ingreso
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
          <Button
            type="button"
            className="h-12 w-full rounded-2xl text-base"
            disabled={pending || !accountId}
            onClick={payPartner}
          >
            {pending ? "Guardando…" : "Registrar cobro"}
          </Button>
          {!state.chargeConfirmed && (
            <p className="text-center text-[11px] text-(--muted-foreground)">
              También confirma tu cargo de {formatMoney(sub.amount)} en {sub.accountName}
            </p>
          )}
        </div>
      )}

      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}

      {targetAccount?.type === "CREDIT" && (
        <div className="space-y-3 rounded-3xl border border-(--border) p-4">
          <AccountMoneySheet
            account={targetAccount}
            sourceOptions={accountOptions.filter(
              (a) => a.id !== targetAccount.id && a.type === "DEBIT",
            )}
            onDone={onDone}
          />
        </div>
      )}
    </div>
  );
}

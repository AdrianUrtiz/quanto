"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTransaction } from "@/lib/actions";
import type { AccountRow } from "@/components/account-card";
import type { AccountOpt } from "@/components/transaction-form";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Pagar tarjeta (TRANSFER desde débito propio) o abonar débito (INCOME).
 * Reutiliza createTransaction: saldos y validaciones ya cubiertos.
 */
export function AccountMoneySheet({
  account,
  sourceOptions,
  onDone,
}: {
  account: AccountRow;
  sourceOptions: AccountOpt[];
  onDone?: () => void;
}) {
  const pay = account.type === "CREDIT";
  const debt = pay ? account.balance : 0;
  const [amount, setAmount] = useState(
    pay && debt > 0 ? String(Math.round(debt * 100) / 100) : "",
  );
  const [concept, setConcept] = useState(pay ? `Pago ${account.name}` : `Abono ${account.name}`);
  const [sourceId, setSourceId] = useState(sourceOptions[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    if (pay) {
      fd.set("type", "TRANSFER");
      fd.set("amount", amount);
      fd.set("concept", concept.trim() || `Pago ${account.name}`);
      fd.set("category", "OTRO");
      fd.set("accountId", sourceId);
      fd.set("transferToAccountId", account.id);
    } else {
      fd.set("type", "INCOME");
      fd.set("amount", amount);
      fd.set("concept", concept.trim() || `Abono ${account.name}`);
      fd.set("category", "TRANSFERENCIA");
      fd.set("accountId", account.id);
    }
    const res = await createTransaction(fd);
    setPending(false);
    if ("error" in res && res.error) {
      setMsg(res.error);
      toast.error(res.error);
    } else {
      setMsg(null);
      toast.success(pay ? "Tarjeta pagada" : "Abono registrado");
      onDone?.();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="text-sm font-bold">{pay ? `Pagar ${account.name}` : `Abonar a ${account.name}`}</p>
        <p className="text-xs text-(--muted-foreground)">
          {pay ? (
            <>Deuda actual <b className="text-(--foreground)">{formatMoney(debt)}</b></>
          ) : (
            <>Saldo actual <b className="text-(--foreground)">{formatMoney(account.balance)}</b></>
          )}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acc-pay-amount">Monto</Label>
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-bold text-(--muted-foreground)">$</span>
          <Input
            id="acc-pay-amount"
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
        <Label htmlFor="acc-pay-concept">Concepto</Label>
        <Input
          id="acc-pay-concept"
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          maxLength={60}
          className="h-12 text-base"
        />
      </div>

      {pay && (
        <div className="space-y-1.5">
          <Label>Pagar desde (débito)</Label>
          {sourceOptions.length === 0 ? (
            <p className="rounded-2xl bg-(--muted) px-4 py-3 text-center text-xs font-semibold text-(--muted-foreground)">
              Necesitas una cuenta de débito como origen
            </p>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {sourceOptions.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSourceId(a.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted)",
                      sourceId === a.id && "bg-(--muted)",
                    )}
                  >
                    <span className="flex-1 text-sm font-semibold">{a.name}</span>
                    {sourceId === a.id && <Check className="size-4 text-(--primary)" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
      <Button
        type="button"
        className="h-12 w-full rounded-2xl text-base"
        disabled={pending || (pay && !sourceId)}
        onClick={submit}
      >
        {pending ? "Guardando…" : pay ? "Pagar tarjeta" : "Abonar"}
      </Button>
    </div>
  );
}

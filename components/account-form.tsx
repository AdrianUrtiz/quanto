"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createAccount } from "@/lib/actions";

export function AccountForm({ onDone }: { onDone?: () => void }) {
  const [type, setType] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const res = await createAccount(new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else {
      setMsg(null);
      onDone?.();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-(--muted) p-1">
        {(["DEBIT", "CREDIT"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-xl py-2 text-sm font-semibold ${type === t ? "bg-(--card) shadow" : "text-(--muted-foreground)"}`}
          >
            {t === "DEBIT" ? "Débito" : "Crédito"}
          </button>
        ))}
      </div>
      <input type="hidden" name="type" value={type} />

      <div className="space-y-1.5">
        <Label htmlFor="acc-name">Nombre de la cuenta</Label>
        <Input id="acc-name" name="name" placeholder={type === "DEBIT" ? "BBVA Débito" : "Nu Crédito"} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="acc-last">Últimos 4 (opcional)</Label>
          <Input id="acc-last" name="lastFour" inputMode="numeric" maxLength={4} placeholder="1234" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-color">Color</Label>
          <Input id="acc-color" name="color" type="color" defaultValue="#6366f1" className="h-11 cursor-pointer p-1" />
        </div>
      </div>

      {type === "DEBIT" ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="acc-init">Saldo inicial (MXN)</Label>
            <Input id="acc-init" name="initialBalance" type="number" min={0} step="0.01" defaultValue={0} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-nomina">Nómina programada</Label>
              <Input id="acc-nomina" name="recurringDeposit" type="number" min={0} step="0.01" placeholder="20000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-freq">Frecuencia</Label>
              <select id="acc-freq" name="depositFrequency" defaultValue="MONTHLY" className="flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-3 text-sm">
                <option value="WEEKLY">Semanal</option>
                <option value="BIWEEKLY">Quincenal</option>
                <option value="MONTHLY">Mensual</option>
              </select>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="acc-limit">Límite de crédito (MXN)</Label>
            <Input id="acc-limit" name="creditLimit" type="number" min={0} step="0.01" placeholder="50000" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-corte">Día de corte (1-31)</Label>
              <Input id="acc-corte" name="statementDay" type="number" min={1} max={31} placeholder="15" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-pago">Día límite de pago</Label>
              <Input id="acc-pago" name="dueDay" type="number" min={1} max={31} placeholder="5" />
            </div>
          </div>
        </>
      )}

      {msg && <p className="text-sm font-medium text-red-500">{msg}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : "Guardar cuenta"}
      </Button>
    </form>
  );
}

// Re-export para tree-shaking simple
export function AccountFormSwitchDemo() {
  const [v, setV] = useState(false);
  return <Switch checked={v} onCheckedChange={setV} />;
}

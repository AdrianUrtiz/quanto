"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAccount, updateAccount } from "@/lib/actions";

export type AccountEditData = {
  id: string;
  name: string;
  type: "DEBIT" | "CREDIT";
  lastFour?: string;
  expiry?: string;
  color: string;
  creditLimit?: number;
  statementDay?: number;
  dueDay?: number;
};

export function AccountForm({ account, onDone }: { account?: AccountEditData; onDone?: () => void }) {
  const editing = Boolean(account);
  const [type, setType] = useState<"DEBIT" | "CREDIT">(account?.type ?? "DEBIT");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const res = editing
      ? await updateAccount(new FormData(e.currentTarget))
      : await createAccount(new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else {
      setMsg(null);
      onDone?.();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {editing && <input type="hidden" name="id" value={account!.id} />}
      {editing ? (
        <p className="rounded-2xl bg-(--muted) px-4 py-2.5 text-sm font-semibold">
          {type === "DEBIT" ? "Débito" : "Crédito"} · el tipo no se puede cambiar
        </p>
      ) : (
        <>
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
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="acc-name">Nombre de la cuenta</Label>
        <Input id="acc-name" name="name" defaultValue={account?.name} placeholder={type === "DEBIT" ? "BBVA Débito" : "Nu Crédito"} required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="acc-last">Últimos 4 (opcional)</Label>
          <Input id="acc-last" name="lastFour" defaultValue={account?.lastFour ?? ""} inputMode="numeric" maxLength={4} placeholder="1234" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-exp">Vencimiento (opcional)</Label>
          <Input id="acc-exp" name="expiry" defaultValue={account?.expiry ?? ""} inputMode="numeric" maxLength={5} placeholder="MM/AA" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acc-color">Color</Label>
        <Input id="acc-color" name="color" type="color" defaultValue={account?.color ?? "#6366f1"} className="h-11 cursor-pointer p-1" />
      </div>

      {type === "DEBIT" ? (
        !editing && (
          <div className="space-y-1.5">
            <Label htmlFor="acc-init">Saldo inicial (MXN)</Label>
            <Input id="acc-init" name="initialBalance" type="number" min={0} step="0.01" defaultValue={0} required />
            <p className="text-xs text-(--muted-foreground)">Los ingresos (nómina, etc.) se registran manualmente como movimientos.</p>
          </div>
        )
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="acc-limit">Límite de crédito (MXN)</Label>
            <Input id="acc-limit" name="creditLimit" type="number" min={0} step="0.01" defaultValue={account?.creditLimit ?? ""} placeholder="50000" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-corte">Día de corte (1-31)</Label>
              <Input id="acc-corte" name="statementDay" type="number" min={1} max={31} defaultValue={account?.statementDay ?? ""} placeholder="15" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-pago">Día límite de pago</Label>
              <Input id="acc-pago" name="dueDay" type="number" min={1} max={31} defaultValue={account?.dueDay ?? ""} placeholder="5" />
            </div>
          </div>
        </>
      )}

      {msg && <p className="text-sm font-medium text-red-500">{msg}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : "Guardar cuenta"}
      </Button>
    </form>
  );
}

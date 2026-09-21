"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createTransaction } from "@/lib/actions";

const CATS = ["COMIDA","TRANSPORTE","VIVIENDA","SERVICIOS","SALUD","OCIO","COMPRAS","EDUCACION","VIAJES","MASCOTAS","SUSCRIPCIONES","NOMINA","OTRO"];
const MSI = [1, 3, 6, 12];

export function TransactionForm({
  accountOptions, onDone,
}: {
  accountOptions: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const [msi, setMsi] = useState(false);
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const res = await createTransaction(new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="tx-amount">Monto total (MXN)</Label>
        <Input id="tx-amount" name="amount" type="number" min={0.01} step="0.01" placeholder="3000" required autoFocus />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tx-concept">Concepto</Label>
        <Input id="tx-concept" name="concept" placeholder="Súper, cena, gasolina…" required />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tx-cat">Categoría</Label>
          <select id="tx-cat" name="category" defaultValue="COMIDA" className="flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-3 text-sm">
            {CATS.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-acc">Cuenta</Label>
          <select id="tx-acc" name="accountId" required defaultValue={accountOptions[0]?.id ?? ""} className="flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-3 text-sm">
            {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tx-date">Fecha</Label>
        <Input id="tx-date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-(--border) p-3.5">
        <div>
          <p className="text-sm font-semibold">Meses sin intereses</p>
          <p className="text-xs text-(--muted-foreground)">Divide el cargo en parcialidades</p>
        </div>
        <Switch checked={msi} onCheckedChange={setMsi} aria-label="Es a meses sin intereses" />
      </div>
      {msi && (
        <div className="grid grid-cols-4 gap-2">
          {MSI.filter((m) => m !== 1).map((m) => (
            <label key={m} className="cursor-pointer rounded-2xl border border-(--border) p-2 text-center text-sm font-semibold has-checked:border-(--primary) has-checked:bg-(--primary)/10">
              <input type="radio" name="installments" value={m} defaultChecked={m === 3} className="sr-only" />
              {m} MSI
            </label>
          ))}
          <input type="hidden" name="installments" value={msi ? undefined : 1} disabled={msi} />
        </div>
      )}
      {!msi && <input type="hidden" name="installments" value={1} />}

      <div className="flex items-center justify-between rounded-2xl border border-(--border) p-3.5">
        <div>
          <p className="text-sm font-semibold">Compartir con mi pareja 50/50</p>
          <p className="text-xs text-(--muted-foreground)">Calcula su aportación mensual automáticamente</p>
        </div>
        <Switch checked={shared} onCheckedChange={setShared} name="isShared" aria-label="Compartir gasto" />
      </div>

      {msg && <p className="text-sm font-medium text-red-500">{msg}</p>}
      {!process.env.NEXT_PUBLIC_DB && accountOptions.length === 0 && (
        <p className="text-xs text-(--muted-foreground)">Sin cuentas: configura DATABASE_URL y crea cuentas primero.</p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : "Registrar"}
      </Button>
    </form>
  );
}

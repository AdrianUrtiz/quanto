"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createTransaction, updateTransaction } from "@/lib/actions";

const CATS = ["COMIDA","TRANSPORTE","VIVIENDA","SERVICIOS","SALUD","OCIO","COMPRAS","EDUCACION","VIAJES","MASCOTAS","SUSCRIPCIONES","NOMINA","OTRO"];
const MSI = [1, 3, 6, 12];

export type AccountOpt = { id: string; name: string; type?: string };

export type TxEditData = {
  id: string;
  amount: number;
  concept: string;
  category: string;
  date: string; // ISO
  accountId: string;
  transferToAccountId?: string | null;
  type: string;
  installments: number;
  isShared: boolean;
};

type Mode = "cargo" | "abono" | "pago";
const MODE_TYPE: Record<Mode, string> = { cargo: "EXPENSE", abono: "INCOME", pago: "TRANSFER" };

function toYMD(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const selectCls = "flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-3 text-sm";

export function TransactionForm({
  accountOptions, entry, onDone,
}: {
  accountOptions: AccountOpt[];
  entry?: TxEditData;
  onDone?: () => void;
}) {
  const editing = Boolean(entry);
  const initialMode: Mode = entry
    ? entry.type === "INCOME"
      ? "abono"
      : entry.type === "TRANSFER"
        ? "pago"
        : "cargo"
    : "cargo";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [msi, setMsi] = useState(false);
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const debits = accountOptions.filter((a) => a.type !== "CREDIT");
  const credits = accountOptions.filter((a) => a.type === "CREDIT");
  // Sin info de tipo (origen legacy): no filtrar, mostrar todas.
  const hasTypes = accountOptions.some((a) => a.type);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const res = editing
      ? await updateTransaction(new FormData(e.currentTarget))
      : await createTransaction(new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  const pagoBlocked = mode === "pago" && hasTypes && (debits.length === 0 || credits.length === 0);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {editing && <input type="hidden" name="id" value={entry!.id} />}
      <input type="hidden" name="type" value={MODE_TYPE[mode]} />

      {editing ? (
        <p className="rounded-2xl bg-(--muted) px-4 py-2.5 text-sm font-semibold">
          {mode === "abono" ? "Abono" : mode === "pago" ? "Pago de tarjeta" : "Cargo"}
          {mode === "cargo" && (entry!.installments > 1 || entry!.isShared) && " · MSI y compartido no se modifican"}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-(--muted) p-1">
          {(["cargo", "abono", "pago"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-xl py-2 text-sm font-semibold ${mode === m ? "bg-(--card) shadow" : "text-(--muted-foreground)"}`}
            >
              {m === "cargo" ? "Cargo" : m === "abono" ? "Abono" : "Pago"}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="tx-amount">Monto (MXN)</Label>
        <Input id="tx-amount" name="amount" type="number" min={0.01} step="0.01" defaultValue={entry?.amount} placeholder="3000" required autoFocus={!editing} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tx-concept">Concepto</Label>
        <Input
          id="tx-concept"
          name="concept"
          defaultValue={entry?.concept ?? (mode === "pago" ? "Pago de tarjeta" : "")}
          placeholder={mode === "abono" ? "Nómina, transferencia recibida…" : mode === "pago" ? "Pago de tarjeta" : "Súper, cena, gasolina…"}
          required
        />
      </div>

      {mode === "pago" ? (
        <>
          <input type="hidden" name="category" value="OTRO" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tx-origin">Sale de (débito)</Label>
              <select id="tx-origin" name="accountId" required defaultValue={entry?.accountId ?? (hasTypes ? debits[0]?.id : accountOptions[0]?.id) ?? ""} className={selectCls}>
                {(hasTypes ? debits : accountOptions).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-dest">Abona a (crédito)</Label>
              <select id="tx-dest" name="transferToAccountId" required defaultValue={entry?.transferToAccountId ?? (hasTypes ? credits[0]?.id : "") ?? ""} className={selectCls}>
                {(hasTypes ? credits : accountOptions).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          {pagoBlocked && (
            <p className="text-xs text-(--muted-foreground)">Necesitas una cuenta de débito y una tarjeta de crédito para registrar pagos.</p>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tx-cat">Categoría</Label>
            <select id="tx-cat" name="category" defaultValue={entry?.category ?? (mode === "abono" ? "NOMINA" : "COMIDA")} className={selectCls}>
              {CATS.map((c) => <option key={c} value={c}>{c.charAt(0) + c.slice(1).toLowerCase()}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-acc">{mode === "abono" ? "Cuenta destino" : "Cuenta"}</Label>
            <select id="tx-acc" name="accountId" required defaultValue={entry?.accountId ?? accountOptions[0]?.id ?? ""} className={selectCls}>
              {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      )}
      {mode === "abono" && !editing && (
        <p className="text-xs text-(--muted-foreground)">En débito suma saldo · en crédito reduce la deuda (libera línea).</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="tx-date">Fecha</Label>
        <Input id="tx-date" name="date" type="date" defaultValue={entry ? toYMD(entry.date) : new Date().toISOString().slice(0, 10)} required />
      </div>

      {mode === "cargo" && !editing && (
        <>
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
        </>
      )}

      {msg && <p className="text-sm font-medium text-red-500">{msg}</p>}
      {!process.env.NEXT_PUBLIC_DB && accountOptions.length === 0 && (
        <p className="text-xs text-(--muted-foreground)">Sin cuentas: configura DATABASE_URL y crea cuentas primero.</p>
      )}
      <Button type="submit" className="w-full" disabled={pending || pagoBlocked}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : mode === "pago" ? "Registrar pago" : mode === "abono" ? "Registrar abono" : "Registrar"}
      </Button>
    </form>
  );
}

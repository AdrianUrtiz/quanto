"use client";

import { useState } from "react";
import { CreditCard, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAccount, updateAccount } from "@/lib/actions";
import { ACCOUNT_COLORS } from "@/lib/categories";
import { cn } from "@/lib/utils";

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

function maskExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

const fieldCls = "h-12 rounded-2xl border border-(--border) bg-(--muted)/50 px-4 text-sm outline-none focus:border-(--primary)";

export function AccountForm({ account, onDone }: { account?: AccountEditData; onDone?: () => void }) {
  const editing = Boolean(account);
  const [type, setType] = useState<"DEBIT" | "CREDIT">(account?.type ?? "DEBIT");
  const [name, setName] = useState(account?.name ?? "");
  const [lastFour, setLastFour] = useState(account?.lastFour ?? "");
  const [expiry, setExpiry] = useState(account?.expiry ?? "");
  const [color, setColor] = useState(account?.color ?? "#6366f1");
  const [initialBalance, setInitialBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState(account?.creditLimit != null ? String(account.creditLimit) : "");
  const [statementDay, setStatementDay] = useState(account?.statementDay != null ? String(account.statementDay) : "");
  const [dueDay, setDueDay] = useState(account?.dueDay != null ? String(account.dueDay) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const Icon = type === "DEBIT" ? Landmark : CreditCard;

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
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      {editing && <input type="hidden" name="id" value={account!.id} />}

      {/* Vista previa en vivo */}
      <div className="rounded-3xl p-4 text-white shadow-lg" style={{ background: color }}>
        <div className="flex items-center justify-between">
          <Icon className="size-6" />
          <span className="text-[11px] font-bold uppercase tracking-widest opacity-80">
            {type === "DEBIT" ? "Débito" : "Crédito"}
          </span>
        </div>
        <p className="mt-3 truncate text-lg font-bold">{name.trim() || "Mi cuenta"}</p>
        <p className="mt-0.5 text-sm font-medium tabular-nums opacity-80">
          ···· {lastFour || "····"}{"  ·  "}{expiry || "MM/AA"}
        </p>
      </div>

      {editing ? (
        <p className="rounded-2xl bg-(--muted) px-4 py-2.5 text-center text-xs font-semibold text-(--muted-foreground)">
          {type === "DEBIT" ? "Débito" : "Crédito"} · el tipo no se puede cambiar
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 rounded-full bg-(--muted) p-1">
          {(["DEBIT", "CREDIT"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "rounded-full py-2 text-sm font-semibold transition",
                type === t ? "bg-(--card) shadow" : "text-(--muted-foreground)",
              )}
            >
              {t === "DEBIT" ? "Débito" : "Crédito"}
            </button>
          ))}
        </div>
      )}
      <input type="hidden" name="type" value={type} />

      <div className="space-y-1.5">
        <Label htmlFor="acc-name">Nombre</Label>
        <Input
          id="acc-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "DEBIT" ? "BBVA Débito" : "Nu Crédito"}
          required
          className="h-12 text-base"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="acc-last">Terminación</Label>
          <Input
            id="acc-last"
            name="lastFour"
            value={lastFour}
            onChange={(e) => setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="1234"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-exp">Vence</Label>
          <Input
            id="acc-exp"
            name="expiry"
            value={expiry}
            onChange={(e) => setExpiry(maskExpiry(e.target.value))}
            inputMode="numeric"
            placeholder="MM/AA"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="grid grid-cols-8 gap-2">
          {ACCOUNT_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => setColor(hex)}
              aria-label={`Color ${hex}`}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2 ring-1 ring-inset ring-black/10 transition active:scale-95",
                color.toLowerCase() === hex ? "border-(--foreground)" : "border-transparent",
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
        <input type="hidden" name="color" value={color} />
      </div>

      {type === "DEBIT" ? (
        !editing && (
          <div className="space-y-1.5">
            <Label htmlFor="acc-init">Saldo inicial</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-bold text-(--muted-foreground)">$</span>
              <Input
                id="acc-init"
                name="initialBalance"
                type="number"
                min={0}
                step={0.01}
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
                required
                className="h-12 text-xl font-bold"
                inputMode="decimal"
                placeholder="0"
              />
            </div>
          </div>
        )
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="acc-limit">Límite de crédito</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-xl font-bold text-(--muted-foreground)">$</span>
              <Input
                id="acc-limit"
                name="creditLimit"
                type="number"
                min={0}
                step={0.01}
                value={creditLimit}
                onChange={(e) => setCreditLimit(e.target.value)}
                placeholder="50000"
                required
                className="h-12 text-xl font-bold"
                inputMode="decimal"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-corte">Día de corte</Label>
              <Input
                id="acc-corte"
                name="statementDay"
                type="number"
                min={1}
                max={31}
                value={statementDay}
                onChange={(e) => setStatementDay(e.target.value)}
                placeholder="15"
                className={fieldCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-pago">Día de pago</Label>
              <Input
                id="acc-pago"
                name="dueDay"
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                placeholder="5"
                className={fieldCls}
              />
            </div>
          </div>
        </>
      )}

      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
      <Button type="submit" className="h-12 w-full rounded-2xl text-base" disabled={pending}>
        {pending ? "Guardando…" : editing ? "Guardar cambios" : "Agregar cuenta"}
      </Button>
    </form>
  );
}

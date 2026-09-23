"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CreditCard,
  LayoutGrid,
  NotebookPen,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createTransaction, updateTransaction } from "@/lib/actions";
import {
  DEFAULT_CATS,
  EMOJI_PRESETS,
  makeCustomCat,
  parseCat,
  prettyCat,
  type CustomCat,
} from "@/lib/categories";
import { cn } from "@/lib/utils";

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
const MSI_OPTS = [1, 3, 6, 12];

type Panel = null | "cats" | "account" | "dest" | "date" | "addcat";

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function shortDate(ymd: string) {
  return fromYMD(ymd)
    .toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    .replace(".", "");
}
function fmtAmount(s: string) {
  const [i, dec] = s.split(".");
  const int = Number(i || "0").toLocaleString("es-MX");
  return dec !== undefined ? `${int}.${dec}` : int;
}

export function TransactionForm({
  accountOptions,
  customs,
  entry,
  onDone,
}: {
  accountOptions: AccountOpt[];
  customs: CustomCat[];
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
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "0");
  const [dateYMD, setDateYMD] = useState(
    entry ? toYMD(new Date(entry.date)) : toYMD(new Date())
  );
  const [desc, setDesc] = useState(entry?.concept ?? "");
  const [editingDesc, setEditingDesc] = useState(false);
  const [accountId, setAccountId] = useState(entry?.accountId ?? accountOptions[0]?.id ?? "");
  const [destId, setDestId] = useState(entry?.transferToAccountId ?? "");
  const [category, setCategory] = useState(entry?.category ?? "COMIDA");
  const [msi, setMsi] = useState(1);
  const [shared, setShared] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [localCustoms, setLocalCustoms] = useState<CustomCat[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState(EMOJI_PRESETS[0]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const allCats = useMemo(
    () => [...DEFAULT_CATS.map((c) => ({ ...c, custom: false })), ...customs, ...localCustoms],
    [customs, localCustoms]
  );
  const debits = accountOptions.filter((a) => a.type !== "CREDIT");
  const credits = accountOptions.filter((a) => a.type === "CREDIT");
  const hasTypes = accountOptions.some((a) => a.type);
  const originOpts = hasTypes ? debits : accountOptions;
  const destOpts = hasTypes ? credits : accountOptions;

  const todayYMD = toYMD(new Date());
  const yesterdayYMD = toYMD(new Date(Date.now() - 86400000));
  const dateLabel =
    dateYMD === todayYMD ? "Hoy" : dateYMD === yesterdayYMD ? "Ayer" : shortDate(dateYMD);
  const accountLabel = accountOptions.find((a) => a.id === accountId)?.name ?? "Cuenta";
  const destLabel = accountOptions.find((a) => a.id === destId)?.name ?? "Tarjeta";
  const catInfo = parseCat(category);

  function press(k: string) {
    setMsg(null);
    setAmount((prev) => {
      if (k === "clear") return "0";
      if (k === "back") return prev.length <= 1 ? "0" : prev.slice(0, -1);
      if (k === ".") return prev.includes(".") ? prev : prev === "" ? "0." : prev + ".";
      let next = prev === "0" ? k : prev + k;
      if (next.includes(".")) {
        const [, dec] = next.split(".");
        if (dec.length > 2) return prev;
      }
      next = next.replace(/^0+(?=\d)/, "");
      if (next.replace(".", "").length > 9) return prev;
      return next;
    });
  }

  async function submit() {
    if (pending) return;
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value <= 0) {
      setMsg("Ingresa un monto mayor a 0");
      return;
    }
    if (!accountId) {
      setMsg("Elige una cuenta");
      return;
    }
    if (mode === "pago" && (!destId || destId === accountId)) {
      setMsg("Elige una tarjeta destino distinta");
      return;
    }
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    if (editing) fd.set("id", entry!.id);
    fd.set("type", MODE_TYPE[mode]);
    fd.set("amount", String(value));
    fd.set("concept", desc.trim() || prettyCat(category));
    fd.set("category", mode === "pago" ? "OTRO" : category);
    fd.set("date", `${dateYMD}T12:00:00`); // mediodía: inmune a desfases de zona horaria
    fd.set("accountId", accountId);
    if (mode === "pago") fd.set("transferToAccountId", destId);
    if (mode === "cargo" && !editing) {
      fd.set("installments", String(msi));
      if (shared) fd.set("isShared", "true");
    }
    const res = editing ? await updateTransaction(fd) : await createTransaction(fd);
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  function saveCustomCat() {
    if (newCatName.trim().length < 2) {
      setMsg("La categoría necesita al menos 2 letras");
      return;
    }
    const code = makeCustomCat(newCatEmoji, newCatName);
    const info = parseCat(code);
    setLocalCustoms((prev) => (prev.some((c) => c.code === code) ? prev : [...prev, info]));
    setCategory(code);
    setNewCatName("");
    setPanel("cats");
    setMsg(null);
  }

  const pagoBlocked = mode === "pago" && hasTypes && (debits.length === 0 || credits.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-1 pb-6">
      {/* Monto + keypad */}
      <div className="flex items-center justify-center gap-2 py-3">
        <span className="text-2xl font-bold text-(--muted-foreground)">$</span>
        <span className="text-5xl font-extrabold tracking-tight tabular-nums">{fmtAmount(amount)}</span>
        <button
          type="button"
          aria-label="Borrar"
          onClick={() => press("clear")}
          className="flex size-8 items-center justify-center rounded-full bg-(--muted) text-(--muted-foreground)"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Pills: fecha · descripción · cuenta */}
      {editingDesc ? (
        <div className="flex items-center gap-2">
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Descripción"
            maxLength={60}
            autoFocus
            className="h-11"
          />
          <Button type="button" size="icon" aria-label="Confirmar descripción" onClick={() => setEditingDesc(false)}>
            <Check className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <button
            type="button"
            onClick={() => setPanel("date")}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
          >
            <CalendarDays className="size-3.5" /> {dateLabel}
          </button>
          <button
            type="button"
            onClick={() => setEditingDesc(true)}
            className={cn(
              "flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold",
              desc ? "border-transparent bg-(--foreground) text-(--background)" : "border-(--border) bg-(--muted)/60"
            )}
          >
            <NotebookPen className="size-3.5" />
            <span className="truncate">{desc || "Descripción"}</span>
          </button>
          {mode === "pago" ? (
            <>
              <button
                type="button"
                onClick={() => setPanel("account")}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
              >
                <Wallet className="size-3.5" /> {accountLabel}
              </button>
              <button
                type="button"
                onClick={() => setPanel("dest")}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
              >
                <CreditCard className="size-3.5" /> {destLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setPanel("account")}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
            >
              <Wallet className="size-3.5" /> {accountLabel}
            </button>
          )}
        </div>
      )}

      {/* Categorías */}
      {mode !== "pago" && (
        <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
          {allCats.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCategory(c.code)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold",
                category === c.code
                  ? "border-transparent bg-(--foreground) text-(--background)"
                  : "border-(--border) bg-(--muted)/60"
              )}
            >
              <span className="text-sm">{c.emoji}</span> {c.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Ver todas las categorías"
            onClick={() => setPanel("cats")}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-(--border) bg-(--muted)/60"
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      )}

      {/* MSI + compartido (solo cargo nuevo) */}
      {mode === "cargo" && !editing && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-4 gap-2">
            {MSI_OPTS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMsi(m)}
                className={cn(
                  "rounded-2xl border py-2 text-xs font-semibold",
                  msi === m
                    ? "border-transparent bg-(--foreground) text-(--background)"
                    : "border-(--border) text-(--muted-foreground)"
                )}
              >
                {m === 1 ? "Contado" : `${m} MSI`}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-(--border) px-4 py-2.5">
            <p className="text-xs font-semibold">Compartir 50/50 con mi pareja</p>
            <Switch checked={shared} onCheckedChange={setShared} aria-label="Compartir gasto" />
          </div>
        </div>
      )}
      {editing && mode === "cargo" && (entry!.installments > 1 || entry!.isShared) && (
        <p className="mt-2 text-center text-[11px] text-(--muted-foreground)">
          MSI y compartido no se modifican
        </p>
      )}

      {msg && <p className="mt-2 text-center text-sm font-medium text-red-500">{msg}</p>}

      {/* Keypad */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "go"].map((k) =>
          k === "go" ? (
            <button
              key={k}
              type="button"
              onClick={submit}
              disabled={pending || pagoBlocked}
              aria-label="Guardar"
              className="flex h-14 items-center justify-center rounded-2xl bg-(--primary) text-xl font-bold text-(--primary-foreground) transition active:scale-95 disabled:opacity-50"
            >
              <ArrowRight className="size-6" />
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => press(k === "." ? "." : k)}
              className="h-14 rounded-2xl bg-(--muted)/70 text-xl font-semibold transition active:scale-95 active:bg-(--muted)"
            >
              {k}
            </button>
          )
        )}
      </div>
      {pagoBlocked && (
        <p className="mt-2 text-center text-xs text-(--muted-foreground)">
          Necesitas una cuenta de débito y una tarjeta de crédito.
        </p>
      )}

      {/* Panel: grid de categorías */}
      <Dialog open={panel === "cats"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="max-h-[86dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="sr-only">Categorías</DialogTitle>
          </DialogHeader>
          {!editing && (
            <div className="mx-auto grid w-fit grid-cols-3 gap-2 rounded-full bg-(--muted) p-1">
              {(["cargo", "abono", "pago"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    if (m === "pago") setPanel(null);
                    if (m === "abono" && category === "COMIDA") setCategory("NOMINA");
                  }}
                  className={cn(
                    "rounded-full px-5 py-2 text-sm font-semibold",
                    mode === m ? "bg-(--card) shadow" : "text-(--muted-foreground)"
                  )}
                >
                  {m === "cargo" ? "Gasto" : m === "abono" ? "Ingreso" : "Pago"}
                </button>
              ))}
            </div>
          )}
          {mode !== "pago" && (
            <div className="grid grid-cols-4 gap-2 pb-2">
              {allCats.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => {
                    setCategory(c.code);
                    setPanel(null);
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-3xl border p-3 transition active:scale-95",
                    category === c.code
                      ? "border-(--primary) bg-(--primary)/10"
                      : "border-transparent bg-(--muted)/60"
                  )}
                >
                  <span className="text-3xl">{c.emoji}</span>
                  <span className="w-full truncate text-center text-[11px] font-medium">{c.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPanel("addcat")}
                className="flex flex-col items-center justify-center gap-1.5 rounded-3xl border border-dashed border-(--border) p-3 text-(--muted-foreground) transition active:scale-95"
              >
                <Plus className="size-6" />
                <span className="text-[11px] font-medium">Nueva</span>
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Panel: nueva categoría */}
      <Dialog open={panel === "addcat"} onOpenChange={(o) => !o && setPanel("cats")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva categoría</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {EMOJI_PRESETS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setNewCatEmoji(e)}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl border text-xl",
                    newCatEmoji === e ? "border-(--primary) bg-(--primary)/10" : "border-(--border)"
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
            <Input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Nombre (ej. Videojuegos)"
              maxLength={30}
            />
            <Button type="button" className="w-full" onClick={saveCustomCat}>
              Crear categoría
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Panel: cuenta (origen / destino) */}
      <Dialog
        open={panel === "account" || panel === "dest"}
        onOpenChange={(o) => !o && setPanel(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{panel === "dest" ? "Tarjeta destino" : "Cuenta"}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {(panel === "dest" ? destOpts : mode === "pago" ? originOpts : accountOptions).map((a) => {
              const selected = panel === "dest" ? destId === a.id : accountId === a.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (panel === "dest") setDestId(a.id);
                      else setAccountId(a.id);
                      setPanel(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)",
                      selected && "bg-(--muted)"
                    )}
                  >
                    <span className="flex-1 text-sm font-semibold">{a.name}</span>
                    {selected && <Check className="size-4 text-(--primary)" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Panel: fecha */}
      <Dialog open={panel === "date"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fecha</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={dateYMD === todayYMD ? "default" : "secondary"}
              onClick={() => {
                setDateYMD(todayYMD);
                setPanel(null);
              }}
            >
              Hoy
            </Button>
            <Button
              type="button"
              variant={dateYMD === yesterdayYMD ? "default" : "secondary"}
              onClick={() => {
                setDateYMD(yesterdayYMD);
                setPanel(null);
              }}
            >
              Ayer
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-date-pick">Otra fecha</Label>
            <Input
              id="tx-date-pick"
              type="date"
              value={dateYMD}
              max={todayYMD}
              onChange={(e) => {
                if (e.target.value) {
                  setDateYMD(e.target.value);
                  setPanel(null);
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

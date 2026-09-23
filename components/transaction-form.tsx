"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  Check,
  Delete,
  LayoutGrid,
  NotebookPen,
  Plus,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createTransaction, updateTransaction } from "@/lib/actions";
import { createCategory } from "@/lib/category-actions";
import {
  CATEGORY_COLORS,
  ICONS,
  ICON_PRESETS,
  lookupCategory,
  prettyCat,
} from "@/lib/categories";
import type { CatalogRow } from "@/lib/catalog";
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
const MODE_TYPE: Record<Mode, string> = {
  cargo: "EXPENSE",
  abono: "INCOME",
  pago: "TRANSFER",
};
const MSI_OPTS = [1, 3, 6, 9, 12, 15, 24];
const msiLabel = (m: number) => (m === 1 ? "Contado" : `${m} MSI`);

type Panel =
  | null
  | "cats"
  | "account"
  | "dest"
  | "date"
  | "addcat"
  | "msi"
  | "share";

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
  cats,
  entry,
  onDone,
}: {
  accountOptions: AccountOpt[];
  cats: CatalogRow[];
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
    entry ? toYMD(new Date(entry.date)) : toYMD(new Date()),
  );
  const [desc, setDesc] = useState(entry?.concept ?? "");
  const [descTouched, setDescTouched] = useState(Boolean(entry?.concept));
  const [editingDesc, setEditingDesc] = useState(false);
  const [accountId, setAccountId] = useState(
    entry?.accountId ?? accountOptions[0]?.id ?? "",
  );
  const [destId, setDestId] = useState(entry?.transferToAccountId ?? "");
  const [category, setCategory] = useState(
    entry?.category ?? (initialMode === "abono" ? "NOMINA" : "COMIDA"),
  );
  const [msi, setMsi] = useState(1);
  const [shared, setShared] = useState(false);
  const [shareMode, setShareMode] = useState<"pct" | "amount">("pct");
  const [sharePct, setSharePct] = useState(50);
  const [shareAmt, setShareAmt] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [localRows, setLocalRows] = useState<CatalogRow[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState<string>(ICON_PRESETS[0]);
  const [newCatColor, setNewCatColor] = useState<string>("#fb923c");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savingCat, setSavingCat] = useState(false);

  const catalog = useMemo(() => [...cats, ...localRows], [cats, localRows]);

  // Solo las categorías del modo activo (gasto o ingreso), resueltas a icono.
  // Si la actual (legado) no está en la lista, se antepone para no perderla.
  const visibleCats = useMemo(() => {
    const want = mode === "abono" ? "income" : "expense";
    const list = catalog
      .map((r) => lookupCategory(r.code, catalog))
      .filter((c) => c.kind === want || c.kind === "both");
    if (entry && !list.some((c) => c.code === entry.category)) {
      return [lookupCategory(entry.category, catalog), ...list];
    }
    return list;
  }, [catalog, mode, entry]);

  // La categoría elegida siempre va primera en el slider.
  const sliderCats = useMemo(() => {
    const i = visibleCats.findIndex((c) => c.code === category);
    if (i <= 0) return visibleCats;
    return [visibleCats[i], ...visibleCats.slice(0, i), ...visibleCats.slice(i + 1)];
  }, [visibleCats, category]);
  const sliderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sliderRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [category]);

  function switchMode(m: Mode) {
    setMode(m);
    if (m === "pago") {
      setPanel(null);
      return;
    }
    const want = m === "abono" ? "income" : "expense";
    const ok = [...cats, ...localRows].some(
      (c) => c.code === category && (c.kind === want || c.kind === "both"),
    );
    if (!ok) setCategory(m === "abono" ? "NOMINA" : "COMIDA");
  }
  const debits = accountOptions.filter((a) => a.type !== "CREDIT");
  const hasTypes = accountOptions.some((a) => a.type);
  const originOpts = hasTypes ? debits : accountOptions;
  // Destino: cualquier cuenta propia distinta del origen (crédito o débito).
  const destOpts = accountOptions.filter((a) => a.id !== accountId);
  const destFallback = destOpts[0]?.id ?? "";
  const shownDest = destId || destFallback;
  const destIsDebit =
    (accountOptions.find((a) => a.id === shownDest)?.type ?? "CREDIT") !==
    "CREDIT";

  const todayYMD = toYMD(new Date());
  const yesterdayYMD = toYMD(new Date(Date.now() - 86400000));
  const dateLabel =
    dateYMD === todayYMD
      ? "Hoy"
      : dateYMD === yesterdayYMD
        ? "Ayer"
        : shortDate(dateYMD);
  const accountLabel =
    accountOptions.find((a) => a.id === accountId)?.name ?? "Cuenta";
  const destLabel =
    accountOptions.find((a) => a.id === shownDest)?.name ?? "Cuenta";

  // Vista previa del reparto (total y mensual según MSI).
  // sharePct = MI porcentaje; a mi pareja le toca el resto.
  const totalNum = Number(amount) || 0;
  const per = Math.max(1, msi);
  const pctMonthly = (totalNum * (100 - sharePct)) / 100 / per;
  const amtNum = Number(shareAmt) || 0;
  const amtMonthly = amtNum / per;
  const amtPct = totalNum > 0 ? (amtNum / totalNum) * 100 : 0;
  const shareLabel = !shared
    ? "Compartir"
    : shareMode === "pct"
      ? `${100 - sharePct}%`
      : shareAmt
        ? `$${fmtAmount(shareAmt)}`
        : "Monto";

  function press(k: string) {
    setMsg(null);
    setAmount((prev) => {
      if (k === "back") return prev.length <= 1 ? "0" : prev.slice(0, -1);
      if (k === ".")
        return prev.includes(".") ? prev : prev === "" ? "0." : prev + ".";
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
    if (mode === "pago" && (!shownDest || shownDest === accountId)) {
      setMsg("Elige una cuenta destino distinta");
      return;
    }
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    if (editing) fd.set("id", entry!.id);
    fd.set("type", MODE_TYPE[mode]);
    fd.set("amount", String(value));
    const autoConcept =
      mode === "pago"
        ? destIsDebit
          ? "Transferencia entre cuentas"
          : "Pago de tarjeta"
        : prettyCat(category);
    fd.set("concept", descTouched ? desc.trim() || autoConcept : autoConcept);
    fd.set("category", mode === "pago" ? "OTRO" : category);
    fd.set("date", `${dateYMD}T12:00:00`); // mediodía: inmune a desfases de zona horaria
    fd.set("accountId", accountId);
    if (mode === "pago") fd.set("transferToAccountId", shownDest);
    if (mode === "cargo" && !editing) {
      fd.set("installments", String(msi));
      if (shared) {
        fd.set("isShared", "true");
        if (shareMode === "pct") {
          fd.set("sharePct", String(100 - sharePct)); // al servidor va el % del deudor
        } else {
          const amt = Number(shareAmt);
          if (!shareAmt || Number.isNaN(amt) || amt <= 0 || amt >= value) {
            setMsg("La aportación debe ser mayor a 0 y menor al total");
            setPending(false);
            return;
          }
          fd.set("shareAmount", String(amt));
        }
      }
    }
    const res = editing
      ? await updateTransaction(fd)
      : await createTransaction(fd);
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  async function saveCustomCat() {
    if (newCatName.trim().length < 2) {
      setMsg("La categoría necesita al menos 2 letras");
      return;
    }
    setSavingCat(true);
    const fd = new FormData();
    fd.set("name", newCatName.trim());
    fd.set("iconName", newCatIcon);
    fd.set("color", newCatColor);
    fd.set("kind", mode === "abono" ? "income" : "expense");
    const res = await createCategory(fd);
    setSavingCat(false);
    if ("error" in res && res.error) {
      setMsg(res.error);
      return;
    }
    if ("category" in res && res.category) {
      const c = res.category;
      setLocalRows((prev) =>
        prev.some((x) => x.code === c.code)
          ? prev
          : [...prev, { id: c.id, code: c.code, name: c.name, iconName: c.iconName, color: c.color, kind: c.kind as "expense" | "income" | "both", isDefault: false, mine: true }],
      );
      setCategory(c.code);
    }
    setNewCatName("");
    setPanel("cats");
    setMsg(null);
  }

  const pagoBlocked =
    mode === "pago" && (debits.length === 0 || accountOptions.length < 2);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-1 pb-6">
      {/* Monto + keypad */}
      <div className="flex items-center justify-center gap-2 py-20">
        <span className="text-2xl font-bold text-(--muted-foreground)">$</span>
        <span className="text-5xl font-extrabold tracking-tight tabular-nums">
          {fmtAmount(amount)}
        </span>
        <button
          type="button"
          aria-label="Borrar último dígito"
          onClick={() => press("back")}
          className="flex size-8 items-center justify-center rounded-full bg-(--muted) text-(--muted-foreground)"
        >
          <Delete className="size-4" />
        </button>
      </div>

      {/* Pills: fecha · descripción · cuenta */}
      {editingDesc ? (
        <div className="flex items-center gap-2">
          <Input
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              setDescTouched(true);
            }}
            placeholder="Descripción"
            maxLength={60}
            autoFocus
            className="h-11"
          />
          <Button
            type="button"
            size="icon"
            aria-label="Confirmar descripción"
            onClick={() => setEditingDesc(false)}
          >
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
              desc
                ? "border-transparent bg-(--foreground) text-(--background)"
                : "border-(--border) bg-(--muted)/60",
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
                className="flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
              >
                <ArrowUpRight className="size-3.5 shrink-0 text-red-400" />
                <span className="truncate">De {accountLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => setPanel("dest")}
                className="flex max-w-[200px] shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
              >
                <ArrowDownLeft className="size-3.5 shrink-0 text-emerald-400" />
                <span className="truncate">A {destLabel}</span>
              </button>
              <button
                type="button"
                aria-label="Cambiar modo"
                onClick={() => setPanel("cats")}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-(--border) bg-(--muted)/60"
              >
                <LayoutGrid className="size-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPanel("account")}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-(--border) bg-(--muted)/60 px-4 py-2 text-xs font-semibold"
              >
                <Wallet className="size-3.5" /> {accountLabel}
              </button>
              {mode === "cargo" && !editing && (
                <button
                  type="button"
                  onClick={() => setPanel("msi")}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold",
                    msi !== 1
                      ? "border-transparent bg-(--foreground) text-(--background)"
                      : "border-(--border) bg-(--muted)/60",
                  )}
                >
                  <CalendarClock className="size-3.5" /> {msiLabel(msi)}
                </button>
              )}
              {mode === "cargo" && !editing && (
                <button
                  type="button"
                  onClick={() => setPanel("share")}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold",
                    shared
                      ? "border-transparent bg-(--foreground) text-(--background)"
                      : "border-(--border) bg-(--muted)/60",
                  )}
                >
                  <Users className="size-3.5" /> {shareLabel}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Categorías: slider ~85% + botón fijo al grid */}
      {mode !== "pago" && (
        <div className="mt-2 flex items-center gap-2">
          <div ref={sliderRef} className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto items-center">
            {sliderCats.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setCategory(c.code)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2.5 text-xs font-semibold",
                  category === c.code
                    ? "border-transparent bg-(--foreground) text-(--background)"
                    : "border-(--border) bg-(--muted)/60",
                )}
              >
                <c.icon className="size-4 shrink-0" style={{ color: c.color }} /> {c.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Ver todas las categorías"
            onClick={() => setPanel("cats")}
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-(--border) bg-(--muted)/60 transition active:scale-95"
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      )}

      {editing &&
        mode === "cargo" &&
        (entry!.installments > 1 || entry!.isShared) && (
          <p className="mt-2 text-center text-[11px] text-(--muted-foreground)">
            MSI y compartido no se modifican
          </p>
        )}

      {msg && (
        <p className="mt-2 text-center text-sm font-medium text-red-500">
          {msg}
        </p>
      )}

      {/* Keypad */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "go"].map(
          (k) =>
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
            ),
        )}
      </div>
      {pagoBlocked && (
        <p className="mt-2 text-center text-xs text-(--muted-foreground)">
          Necesitas una cuenta de débito y una tarjeta de crédito.
        </p>
      )}

      {/* Panel: grid de categorías */}
      <Dialog
        open={panel === "cats"}
        onOpenChange={(o) => !o && setPanel(null)}
      >
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
                  onClick={() => switchMode(m)}
                  className={cn(
                    "rounded-full px-5 py-2 text-sm font-semibold",
                    mode === m
                      ? "bg-(--card) shadow"
                      : "text-(--muted-foreground)",
                  )}
                >
                  {m === "cargo" ? "Gasto" : m === "abono" ? "Ingreso" : "Pago"}
                </button>
              ))}
            </div>
          )}
          {mode !== "pago" && (
            <div className="grid grid-cols-4 gap-2 pb-2">
              {visibleCats.map((c) => (
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
                      : "border-transparent bg-(--muted)/60",
                  )}
                >
                  <c.icon className="size-7" style={{ color: c.color }} />
                  <span className="w-full truncate text-center text-[11px] font-medium">
                    {c.label}
                  </span>
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
      <Dialog
        open={panel === "addcat"}
        onOpenChange={(o) => !o && setPanel("cats")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva categoría</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {ICON_PRESETS.map((name) => {
                const Icon = ICONS[name] ?? ICONS.Shapes;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setNewCatIcon(name)}
                    aria-label={name}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-2xl border",
                      newCatIcon === name
                        ? "border-(--primary) bg-(--primary)/10"
                        : "border-(--border)",
                    )}
                  >
                    <Icon className="size-5" style={{ color: newCatColor }} />
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-8 gap-2">
              {CATEGORY_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setNewCatColor(hex)}
                  aria-label={`Color ${hex}`}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border-2 ring-1 ring-inset ring-black/10",
                    newCatColor === hex ? "border-(--foreground)" : "border-transparent",
                  )}
                  style={{ backgroundColor: hex }}
                >
                  {newCatColor === hex && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
            <Input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Nombre (ej. Videojuegos)"
              maxLength={30}
            />
            <Button type="button" className="w-full" onClick={saveCustomCat} disabled={savingCat}>
              {savingCat ? "Creando…" : "Crear categoría"}
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
            <DialogTitle>
              {panel === "dest"
                ? "¿A qué cuenta llega?"
                : mode === "pago"
                  ? "¿De qué cuenta sale?"
                  : "Cuenta"}
            </DialogTitle>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {(panel === "dest"
              ? destOpts
              : mode === "pago"
                ? originOpts
                : accountOptions
            ).map((a) => {
              const selected =
                panel === "dest" ? shownDest === a.id : accountId === a.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (panel === "dest") setDestId(a.id);
                      else {
                        setAccountId(a.id);
                        if (destId === a.id) setDestId("");
                      }
                      setPanel(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)",
                      selected && "bg-(--muted)",
                    )}
                  >
                    <span className="flex-1 text-sm font-semibold">
                      {a.name}
                    </span>
                    {selected && <Check className="size-4 text-(--primary)" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Panel: meses sin intereses */}
      <Dialog open={panel === "msi"} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Meses sin intereses</DialogTitle>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
            {MSI_OPTS.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => {
                    setMsi(m);
                    setPanel(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted)",
                    msi === m && "bg-(--muted)",
                  )}
                >
                  <span className="flex-1 text-sm font-semibold">
                    {msiLabel(m)}
                  </span>
                  {msi === m && <Check className="size-4 text-(--primary)" />}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {/* Panel: compartir (porcentaje o cantidad fija) */}
      <Dialog
        open={panel === "share"}
        onOpenChange={(o) => !o && setPanel(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Compartir gasto</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between rounded-2xl border border-(--border) px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Compartir con mi pareja</p>
              <p className="text-xs text-(--muted-foreground)">
                Define su aportación
              </p>
            </div>
            <Switch
              checked={shared}
              onCheckedChange={setShared}
              aria-label="Compartir gasto"
            />
          </div>

          {shared && (
            <>
              <div className="mx-auto grid w-fit grid-cols-2 gap-2 rounded-full bg-(--muted) p-1">
                {(["pct", "amount"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setShareMode(m)}
                    className={cn(
                      "rounded-full px-5 py-2 text-sm font-semibold",
                      shareMode === m
                        ? "bg-(--card) shadow"
                        : "text-(--muted-foreground)",
                    )}
                  >
                    {m === "pct" ? "Porcentaje" : "Cantidad"}
                  </button>
                ))}
              </div>

              {shareMode === "pct" ? (
                <div className="space-y-2 rounded-3xl border border-(--border) p-4">
                  <p className="text-center text-4xl font-extrabold tabular-nums">
                    {sharePct}%
                  </p>
                  <input
                    type="range"
                    min={1}
                    max={99}
                    value={sharePct}
                    onChange={(e) => setSharePct(Number(e.target.value))}
                    aria-label="Mi porcentaje del gasto"
                    className="w-full accent-(--primary)"
                  />
                  <div className="flex justify-between text-[11px] text-(--muted-foreground)">
                    <span>Tú {sharePct}%</span>
                    <span>Pareja {100 - sharePct}%</span>
                  </div>
                  <p className="text-center text-sm">
                    Tu pareja aporta{" "}
                    <b>
                      ${fmtAmount(pctMonthly.toFixed(2))}/mes
                      {msi > 1 ? ` × ${msi}` : ""}
                    </b>{" "}
                    de ${fmtAmount(amount || "0")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 rounded-3xl border border-(--border) p-4">
                  <Label htmlFor="share-amt">
                    ¿Cuánto aporta tu pareja? (total)
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-(--muted-foreground)">
                      $
                    </span>
                    <Input
                      id="share-amt"
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={shareAmt}
                      onChange={(e) => setShareAmt(e.target.value)}
                      placeholder="125"
                      inputMode="decimal"
                    />
                  </div>
                  {amtNum > 0 && (
                    <p className="text-center text-sm">
                      Equivale al <b>{amtPct.toFixed(1)}%</b> ·{" "}
                      <b>
                        ${fmtAmount(amtMonthly.toFixed(2))}/mes
                        {msi > 1 ? ` × ${msi}` : ""}
                      </b>
                    </p>
                  )}
                  <p className="text-center text-[11px] text-(--muted-foreground)">
                    Monto fijo pactado: no cambiará aunque edites el total
                  </p>
                </div>
              )}

              <Button
                type="button"
                className="w-full"
                onClick={() => setPanel(null)}
              >
                Listo
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Panel: fecha */}
      <Dialog
        open={panel === "date"}
        onOpenChange={(o) => !o && setPanel(null)}
      >
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



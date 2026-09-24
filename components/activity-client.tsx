"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { ActivityChart } from "@/components/activity-chart";
import { TransactionSwipeRow } from "@/components/transaction-swipe-row";
import { TransactionRow, type TxRow } from "@/components/transaction-list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/utils";
import { lookupCategory } from "@/lib/categories";
import type { CatalogRow } from "@/lib/catalog";

export type MonthOpt = { key: string; label: string; total: number };

type Range = "mensual" | "semanal" | "trimestral" | "seis" | "anio" | "todo";
type Kind = "gastos" | "ingresos" | "todos";
type Sheet = null | "kind" | "range" | "month" | "account" | "category";

const RANGES: { value: Range; label: string }[] = [
  { value: "mensual", label: "Mensual" },
  { value: "semanal", label: "Semanal" },
  { value: "trimestral", label: "Trimestral" },
  { value: "seis", label: "Últimos 6 meses" },
  { value: "anio", label: "Todo el año" },
  { value: "todo", label: "Todo el tiempo" },
];

const KINDS: { value: Kind; label: string }[] = [
  { value: "gastos", label: "Gastos" },
  { value: "ingresos", label: "Ingresos" },
  { value: "todos", label: "Toda la actividad" },
];

const RANGE_DESC: Record<Range, string> = {
  mensual: "",
  semanal: "Por día · últimos 7 días",
  trimestral: `Por trimestre · ${new Date().getFullYear()}`,
  seis: "Por mes · últimos 6 meses",
  anio: `Por mes · ${new Date().getFullYear()}`,
  todo: "Acumulado por año",
};

function keyOf(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function shortMonth(d: Date) {
  const s = d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
  return d.getFullYear() === new Date().getFullYear()
    ? s
    : `${s} ${String(d.getFullYear()).slice(2)}`;
}

/** Inicio del rango (el fin siempre es hoy). Null = mes seleccionado. */
function rangeStart(range: Range): Date | null {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case "mensual":
      return null;
    case "semanal":
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6);
    case "trimestral":
      return new Date(now.getFullYear(), 0, 1); // trimestres del año en curso
    case "seis":
      return new Date(now.getFullYear(), now.getMonth() - 5, 1); // 6 meses calendario
    case "anio":
      return new Date(now.getFullYear(), 0, 1);
    case "todo":
      return new Date(2000, 0, 1);
  }
}

export function ActivityClient({
  txs,
  months,
  cats,
}: {
  txs: TxRow[];
  months: MonthOpt[];
  cats: CatalogRow[];
}) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [month, setMonth] = useState(
    months[0]?.key ?? keyOf(new Date().toISOString()),
  );
  const [kind, setKind] = useState<Kind>("gastos");
  const [range, setRange] = useState<Range>("mensual");
  const [account, setAccount] = useState("todas");
  const [category, setCategory] = useState("todas");
  const [q, setQ] = useState("");

  const monthLabel = months.find((m) => m.key === month)?.label ?? month;
  const start = rangeStart(range);

  // 1) Rango temporal
  const rangeTxs = useMemo(() => {
    if (range === "mensual") return txs.filter((t) => keyOf(t.date) === month);
    const end = new Date();
    return txs.filter((t) => {
      const d = new Date(t.date);
      return d >= start! && d <= end;
    });
  }, [txs, range, month, start]);

  // Suma según el tipo activo (para totales de cuentas/categorías).
  const inKind = (t: TxRow) =>
    kind === "ingresos" ? t.type === "INCOME" : t.type === "EXPENSE";

  // 2) Filtros restantes
  const filtered = useMemo(() => {
    return rangeTxs.filter((t) => {
      if (kind !== "todos" && !inKind(t)) return false;
      if (account !== "todas" && t.accountName !== account) return false;
      if (category !== "todas" && t.category !== category) return false;
      if (
        q &&
        !`${t.concept} ${t.category}`.toLowerCase().includes(q.toLowerCase())
      )
        return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind, account, category, q]);

  const shownTotal = useMemo(
    () => filtered.filter(inKind).reduce((a, t) => a + t.amount, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, kind],
  );

  // 3) Buckets del gráfico según la granularidad del periodo:
  //    mensual → días · semanal → 7 días · trimestral → T1-T4 del año ·
  //    seis → 6 meses · anio → 12 meses · todo → por año.
  const { buckets, todayIndex } = useMemo(() => {
    const onlyExpenses = rangeTxs.filter((t) => t.type === "EXPENSE");
    const now = new Date();

    if (range === "mensual") {
      const [y, m] = month.split("-").map(Number);
      const dim = new Date(y, m, 0).getDate();
      const arr = Array.from({ length: dim }, (_, i) => ({
        label: `${i + 1}`,
        total: 0,
      }));
      for (const t of onlyExpenses) {
        const d = new Date(t.date).getDate();
        if (d >= 1 && d <= dim) arr[d - 1].total += t.amount;
      }
      const isCur = keyOf(new Date().toISOString()) === month;
      return {
        buckets: arr,
        todayIndex: isCur ? new Date().getDate() - 1 : null,
      };
    }

    if (range === "semanal") {
      const WD = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
      const days: { label: string; total: number }[] = [];
      const idxByDay = new Map<string, number>();
      const cur = new Date(start!);
      const today = new Date();
      while (cur <= today) {
        idxByDay.set(dayKey(cur), days.length);
        days.push({ label: `${WD[cur.getDay()]} ${cur.getDate()}`, total: 0 });
        cur.setDate(cur.getDate() + 1);
      }
      for (const t of onlyExpenses) {
        const i = idxByDay.get(dayKey(new Date(t.date)));
        if (i !== undefined) days[i].total += t.amount;
      }
      return { buckets: days, todayIndex: days.length - 1 };
    }

    if (range === "trimestral") {
      const y = now.getFullYear();
      const arr = ["T1", "T2", "T3", "T4"].map((label) => ({
        label,
        total: 0,
      }));
      for (const t of onlyExpenses) {
        const d = new Date(t.date);
        if (d.getFullYear() !== y || d > now) continue;
        arr[Math.floor(d.getMonth() / 3)].total += t.amount;
      }
      return { buckets: arr, todayIndex: Math.floor(now.getMonth() / 3) };
    }

    if (range === "seis") {
      const arr: { label: string; total: number; y: number; m: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        arr.push({
          label: shortMonth(d),
          total: 0,
          y: d.getFullYear(),
          m: d.getMonth(),
        });
      }
      for (const t of onlyExpenses) {
        const d = new Date(t.date);
        const b = arr.find(
          (b) => b.y === d.getFullYear() && b.m === d.getMonth(),
        );
        if (b) b.total += t.amount;
      }
      return { buckets: arr, todayIndex: arr.length - 1 };
    }

    if (range === "anio") {
      const y = now.getFullYear();
      const arr = Array.from({ length: 12 }, (_, m) => ({
        label: shortMonth(new Date(y, m, 1)),
        total: 0,
      }));
      for (const t of onlyExpenses) {
        const d = new Date(t.date);
        if (d.getFullYear() !== y || d > now) continue;
        arr[d.getMonth()].total += t.amount;
      }
      return { buckets: arr, todayIndex: now.getMonth() };
    }

    // todo: acumulado por año
    const years = new Map<number, number>();
    for (const t of onlyExpenses) {
      const y = new Date(t.date).getFullYear();
      years.set(y, (years.get(y) ?? 0) + t.amount);
    }
    const keys = [...years.keys()].sort((a, b) => a - b);
    const minY = keys.length ? keys[0] : now.getFullYear();
    const arr: { label: string; total: number }[] = [];
    for (let y = minY; y <= now.getFullYear(); y++)
      arr.push({ label: `${y}`, total: years.get(y) ?? 0 });
    return { buckets: arr, todayIndex: arr.length - 1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, range, month]);

  // Opciones de cuenta para el diálogo de edición (solo las mías, ya filtradas).
  const accountOptionsAll = useMemo(() => {
    const map = new Map<string, { name: string; type: string }>();
    for (const t of txs)
      map.set(t.accountId, { name: t.accountName, type: t.accountType });
    return [...map.entries()].map(([id, v]) => ({
      id,
      name: v.name,
      type: v.type,
    }));
  }, [txs]);

  // Opciones con totales (respetan el tipo activo)
  const accountOpts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rangeTxs) {
      if (!inKind(t)) continue;
      map.set(t.accountName, (map.get(t.accountName) ?? 0) + t.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind]);

  const categoryOpts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rangeTxs) {
      if (!inKind(t)) continue;
      map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeTxs, kind]);

  const kindLabel = KINDS.find((k) => k.value === kind)!.label;
  const rangeLabel = RANGES.find((r) => r.value === range)!.label;

  function close() {
    setSheet(null);
  }

  return (
    <div className="space-y-4 px-5 pt-4">
      {range === "mensual" ? (
        <div className="flex items-center justify-center">
          <button
            onClick={() => setSheet("month")}
            className="rounded-full bg-(--muted) px-4 py-1.5 text-xs font-semibold capitalize"
          >
            {monthLabel} ▾
          </button>
        </div>
      ) : (
        <p className="text-center text-xs font-semibold text-(--muted-foreground)">
          {RANGE_DESC[range]}
        </p>
      )}
      <p className="text-center text-5xl font-extrabold tracking-tight">
        {formatMoney(shownTotal)}
      </p>

      <ActivityChart
        key={`${range}-${month}`}
        buckets={buckets}
        todayIndex={todayIndex}
      />

      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-full border border-(--border) bg-(--card) px-4 py-2.5">
          <Search className="size-4 text-(--muted-foreground)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            className="w-full bg-transparent text-sm outline-none placeholder:text-(--muted-foreground)"
          />
        </div>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <FilterPill
            label={kindLabel}
            active={kind !== "gastos"}
            onClick={() => setSheet("kind")}
          />
          <FilterPill
            label={rangeLabel}
            active={range !== "mensual"}
            onClick={() => setSheet("range")}
          />
          <FilterPill
            label={account === "todas" ? "Todas las cuentas" : account}
            active={account !== "todas"}
            onClick={() => setSheet("account")}
          />
          <FilterPill
            label={
              category === "todas"
                ? "Todas las categorías"
                : lookupCategory(category, cats).label
            }
            active={category !== "todas"}
            onClick={() => setSheet("category")}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">
          Sin movimientos en este periodo.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) =>
            t.locked ? (
              <TransactionRow key={t.id} t={t} cats={cats} />
            ) : (
              <TransactionSwipeRow
                key={t.id}
                t={t}
                accountOptions={accountOptionsAll}
                cats={cats}
                open={openRow === t.id}
                onOpenChange={(o) => setOpenRow(o ? t.id : null)}
              />
            ),
          )}
        </ul>
      )}

      <Dialog open={sheet !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {sheet === "kind" && "Tipo de movimiento"}
              {sheet === "range" && "Periodo"}
              {sheet === "month" && "Seleccionar mes"}
              {sheet === "account" && "Filtrar por cuenta"}
              {sheet === "category" && "Filtrar por categoría"}
            </DialogTitle>
          </DialogHeader>

          {sheet === "kind" && (
            <Options
              items={KINDS.map((k) => ({ value: k.value, label: k.label }))}
              value={kind}
              onPick={(v) => {
                setKind(v as Kind);
                close();
              }}
            />
          )}
          {sheet === "range" && (
            <Options
              items={RANGES.map((r) => ({ value: r.value, label: r.label }))}
              value={range}
              onPick={(v) => {
                setRange(v as Range);
                close();
              }}
            />
          )}
          {sheet === "month" && (
            <Options
              items={months.map((m) => ({
                value: m.key,
                label: m.label,
                total: m.total,
                cap: true,
              }))}
              value={month}
              onPick={(v) => {
                setMonth(v);
                close();
              }}
            />
          )}
          {sheet === "account" && (
            <Options
              items={[
                { value: "todas", label: "Todas las cuentas" },
                ...accountOpts.map(([name, total]) => ({
                  value: name,
                  label: name,
                  total,
                })),
              ]}
              value={account}
              onPick={(v) => {
                setAccount(v);
                close();
              }}
            />
          )}
          {sheet === "category" && (
            <Options
              items={[
                { value: "todas", label: "Todas las categorías" },
                ...categoryOpts.map(([cat, total]) => ({
                  value: cat,
                  label: lookupCategory(cat, cats).label,
                  total,
                })),
              ]}
              value={category}
              onPick={(v) => {
                setCategory(v);
                close();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`max-w-55 shrink-0 truncate rounded-full border px-4 py-2 text-xs font-semibold transition ${
        active
          ? "border-transparent bg-(--foreground) text-(--background)"
          : "border-(--border) bg-(--card) text-(--muted-foreground)"
      }`}
    >
      {label}
    </button>
  );
}

function Options({
  items,
  value,
  onPick,
}: {
  items: { value: string; label: string; total?: number; cap?: boolean }[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <ul className="max-h-[50dvh] space-y-1 overflow-y-auto">
      {items.map((it) => (
        <li key={it.value}>
          <button
            onClick={() => onPick(it.value)}
            className={`flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted) ${
              it.value === value ? "bg-(--muted)" : ""
            }`}
          >
            <span
              className={`flex-1 text-sm font-semibold ${it.cap ? "capitalize" : ""}`}
            >
              {it.label}
            </span>
            {it.total !== undefined && (
              <span className="text-sm font-bold">{formatMoney(it.total)}</span>
            )}
            {it.value === value && (
              <Check className="size-4 text-(--primary)" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

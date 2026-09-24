"use client";

import { Pause, Pencil, Play, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SwipeRow } from "@/components/swipe-row";
import { formatMoney } from "@/lib/utils";
import { lookupCategory } from "@/lib/categories";
import type { CatalogRow } from "@/lib/catalog";
import type { SubRow } from "@/components/subscription-tab";
import { cn } from "@/lib/utils";

function shareLine(s: SubRow) {
  if (!s.isShared) return null;
  if (s.shareAmount != null) return `Compartida · ${formatMoney(s.shareAmount)}/mes`;
  return `Compartida · ${s.sharePct}%`;
}

function HistoryStrip({ s }: { s: SubRow }) {
  if (!s.history.length) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {s.history.map((h) => {
        const done = h.confirmed && (!h.isShared || h.partnerPaid);
        const waiting = h.confirmed && h.isShared && !h.partnerPaid;
        return (
          <span key={h.monthKey} title={h.monthKey} className="flex flex-col items-center gap-0.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                done ? "bg-emerald-500" : waiting ? "bg-amber-500" : "bg-(--border)",
              )}
            />
            <span className="text-[8px] leading-none text-(--muted-foreground)">{h.short}</span>
          </span>
        );
      })}
    </div>
  );
}

function SubFront({ s, cats }: { s: SubRow; cats: CatalogRow[] }) {
  const cat = lookupCategory(s.category, cats);
  const share = shareLine(s);
  return (
    <div
      className={`rounded-3xl border p-3.5 ${
        s.isActive ? "border-(--border) bg-(--card)" : "border-dashed border-(--border) bg-(--muted)/40 opacity-70"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
        >
          <cat.icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {s.isMine ? s.name : `${s.name} · de ${s.ownerName}`}{" "}
            {!s.isActive && <Badge variant="secondary">Pausada</Badge>}
          </p>
          <p className="truncate text-xs text-(--muted-foreground)">
            Día {s.chargeDay} · {s.accountName}
            {share && <> · {share}</>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-extrabold">{formatMoney(s.amount)}</p>
          <p className="text-[11px] text-(--muted-foreground)">/mes</p>
        </div>
      </div>
      <HistoryStrip s={s} />
    </div>
  );
}

const actionCls =
  "flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-(--foreground) shadow-xs transition-all hover:bg-(--muted) active:scale-95";

export function SubscriptionSwipeRow({
  s, cats, open, onOpenChange, onToggle, onEdit, onDelete, readOnly,
}: {
  s: SubRow;
  cats: CatalogRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return <SubFront s={s} cats={cats} />;
  }
  return (
    <SwipeRow
      open={open}
      onOpenChange={onOpenChange}
      actionsWidth={224}
      actions={
        <>
          <button type="button" onClick={() => { onOpenChange(false); onToggle?.(); }} className={actionCls}>
            {s.isActive ? <Pause className="size-4 text-(--foreground)" /> : <Play className="size-4 text-(--foreground)" />}
            <span>{s.isActive ? "Pausar" : "Seguir"}</span>
          </button>
          <button type="button" onClick={() => { onOpenChange(false); onEdit?.(); }} className={actionCls}>
            <Pencil className="size-4 text-(--foreground)" />
            <span>Editar</span>
          </button>
          <button
            type="button"
            onClick={() => { onOpenChange(false); onDelete?.(); }}
            className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-red-500 text-xs font-semibold text-white shadow-xs transition-all hover:bg-red-600 active:scale-95"
          >
            <Trash2 className="size-4" />
            <span>Eliminar</span>
          </button>
        </>
      }
    >
      <SubFront s={s} cats={cats} />
    </SwipeRow>
  );
}

/** Concentrado para la pestaña Todas: solo total, el detalle vive en Suscripciones. */
export function SubscriptionSummaryRow({ s, onOpen }: { s: SubRow; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-3xl border border-(--border) bg-(--card) p-4 text-left transition active:scale-[.99]"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--primary) text-white">
        <Repeat className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{s.name}</span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          Suscripción · día {s.chargeDay}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">{formatMoney(s.amount)}</span>
        <span className="block text-[11px] font-semibold text-(--primary)">Ver detalle ›</span>
      </span>
    </button>
  );
}

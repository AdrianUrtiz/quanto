"use client";

import { ArrowUpRight, HandCoins, Pause, Pencil, Play, Repeat, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SwipeRow } from "@/components/swipe-row";
import { formatMoney } from "@/lib/utils";
import { lookupCategory } from "@/lib/categories";
import type { CatalogRow } from "@/lib/catalog";
import type { SubPayState, SubRow } from "@/components/subscription-tab";

function SubFront({ s, cats }: { s: SubRow; cats: CatalogRow[] }) {
  const cat = lookupCategory(s.category, cats);
  return (
    <div
      className={`flex items-center gap-3 rounded-3xl border p-3.5 ${
        s.isActive ? "border-(--border) bg-(--card)" : "border-dashed border-(--border) bg-(--muted)/40 opacity-70"
      }`}
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-2xl"
        style={{ backgroundColor: `${cat.color}22`, color: cat.color }}
      >
        <cat.icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {s.name} {!s.isActive && <Badge variant="secondary">Pausada</Badge>}
        </p>
        <p className="truncate text-xs text-(--muted-foreground)">
          Día {s.chargeDay} · {s.accountName}
          {s.isShared && <> · comparte {s.shareAmount ?? `${s.sharePct}%`}</>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-base font-extrabold">{formatMoney(s.amount)}</p>
        <p className="text-[11px] text-(--muted-foreground)">/mes</p>
      </div>
    </div>
  );
}

const actionCls =
  "flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-(--foreground) shadow-xs transition-all hover:bg-(--muted) active:scale-95";

export function SubscriptionSwipeRow({
  s, cats, open, onOpenChange, onToggle, onEdit, onDelete, pay, onPay,
}: {
  s: SubRow;
  cats: CatalogRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  pay?: SubPayState;
  onPay: () => void;
}) {
  // Dinero a la derecha: confirmar el cobro de la plataforma, cobrar a la
  // pareja, o saldar la tarjeta (crédito siempre se puede abonar).
  const moneyOpen =
    pay != null &&
    s.isActive &&
    (!pay.chargeConfirmed ||
      (s.isShared && pay.monthly - pay.paid > 0.005) ||
      pay.accountType === "CREDIT");
  return (
    <SwipeRow
      open={open}
      onOpenChange={onOpenChange}
      actionsWidth={224}
      leftActionsWidth={80}
      leftActions={
        moneyOpen ? (
          s.isShared ? (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onPay();
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 text-xs font-semibold text-white shadow-xs transition-all active:scale-95"
            >
              <HandCoins className="size-4" />
              <span>Cobrar</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onPay();
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-(--foreground) text-xs font-semibold text-(--background) shadow-xs transition-all active:scale-95"
            >
              <ArrowUpRight className="size-4" />
              <span>Pagar</span>
            </button>
          )
        ) : undefined
      }
      actions={
        <>
          <button type="button" onClick={() => { onOpenChange(false); onToggle(); }} className={actionCls}>
            {s.isActive ? <Pause className="size-4 text-(--foreground)" /> : <Play className="size-4 text-(--foreground)" />}
            <span>{s.isActive ? "Pausar" : "Seguir"}</span>
          </button>
          <button type="button" onClick={() => { onOpenChange(false); onEdit(); }} className={actionCls}>
            <Pencil className="size-4 text-(--foreground)" />
            <span>Editar</span>
          </button>
          <button
            type="button"
            onClick={() => { onOpenChange(false); onDelete(); }}
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

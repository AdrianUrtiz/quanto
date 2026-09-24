"use client";

import { Check } from "lucide-react";
import { formatMoney } from "@/lib/utils";

export function FilterPill({
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
      {label} ▾
    </button>
  );
}

export type FilterOption = {
  value: string;
  label: string;
  total?: number;
  meta?: string;
  cap?: boolean;
};

export function FilterOptions({
  items,
  value,
  onPick,
}: {
  items: FilterOption[];
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
            <span className={`flex-1 text-sm font-semibold ${it.cap ? "capitalize" : ""}`}>
              {it.label}
            </span>
            {it.total !== undefined && (
              <span className="text-sm font-bold">{formatMoney(it.total)}</span>
            )}
            {it.meta !== undefined && (
              <span className="text-xs text-(--muted-foreground)">{it.meta}</span>
            )}
            {it.value === value && <Check className="size-4 text-(--primary)" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

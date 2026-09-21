"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";

export type Bucket = { label: string; total: number };

/** Barras diarias genéricas: sirve para un mes o para un rango (7/90/180/365 días). */
export function ActivityChart({ buckets, todayIndex }: { buckets: Bucket[]; todayIndex?: number | null }) {
  const [sel, setSel] = useState<number | null>(null);
  const n = buckets.length;
  const max = Math.max(0, ...buckets.map((b) => b.total));
  const peakIdx = buckets.findIndex((b) => max > 0 && b.total === max);
  const selTotal = sel != null ? buckets[sel]?.total ?? 0 : null;

  const ticks = useMemo(() => {
    if (n <= 1) return [0];
    const pts = new Set<number>([0, n - 1]);
    for (let i = 1; i < 4; i++) pts.add(Math.round(((n - 1) * i) / 4));
    return [...pts].sort((a, b) => a - b);
  }, [n]);

  const gap = n > 120 ? "gap-0" : n > 31 ? "gap-px" : "gap-[3px]";
  const barW = n > 31 ? "w-full" : "w-full max-w-3";

  return (
    <div>
      <div className="flex h-5 items-center justify-center text-xs font-semibold text-(--muted-foreground)">
        {sel != null && buckets[sel] ? (
          <span>
            {buckets[sel].label} · <span className="text-(--foreground)">{formatMoney(selTotal ?? 0)}</span>
            {peakIdx === sel && <span className="text-(--primary)"> · pico</span>}
          </span>
        ) : (
          <span>
            {peakIdx >= 0 && buckets[peakIdx]
              ? `Pico: ${buckets[peakIdx].label} · ${formatMoney(max)}`
              : "Sin gastos en el periodo"}
          </span>
        )}
      </div>

      <div className={`flex h-28 items-stretch ${gap}`} role="img" aria-label="Gastos por día">
        {buckets.map((b, i) => {
          const active = sel === i;
          const isPeak = peakIdx === i;
          return (
            <button
              key={i}
              onClick={() => setSel((s) => (s === i ? null : i))}
              aria-label={`${b.label}: ${formatMoney(b.total)}`}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1 py-0.5"
            >
              <div
                className={`bar-anim ${barW} rounded-full ${
                  active ? "bg-(--foreground)" : isPeak ? "bg-(--primary)" : "bg-(--primary)/50"
                }`}
                style={{
                  height: `${b.total > 0 ? Math.max(4, (b.total / Math.max(1, max)) * 100) : 2}%`,
                  opacity: b.total > 0 ? 1 : 0.35,
                }}
              />
              {todayIndex === i ? <span className="size-1 rounded-full bg-(--foreground)" /> : <span className="size-1" />}
            </button>
          );
        })}
      </div>

      <div className="relative mt-1 h-4 text-[10px] text-(--muted-foreground)">
        {ticks.map((i) => (
          <span
            key={i}
            className="absolute max-w-[72px] -translate-x-1/2 truncate"
            style={{ left: `${(((i + 0.5)) / Math.max(1, n)) * 100}%` }}
          >
            {buckets[i]?.label}
          </span>
        ))}
      </div>
    </div>
  );
}

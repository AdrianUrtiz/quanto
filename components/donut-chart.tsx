"use client";

import { formatMoney } from "@/lib/utils";

const FALLBACK = ["#818cf8", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7", "#84cc16"];

export function DonutChart({ total, slices }: { total: number; slices: { label: string; value: number; color?: string }[] }) {
  const sum = Math.max(1, slices.reduce((a, s) => a + s.value, 0));
  let acc = 0;
  const segs = slices.map((s, i) => {
    const color = s.color ?? FALLBACK[i % FALLBACK.length];
    const start = (acc / sum) * 100;
    acc += s.value;
    const end = (acc / sum) * 100;
    return `${color} ${start}% ${end}%`;
  });
  const bg = segs.length ? `conic-gradient(${segs.join(",")})` : "conic-gradient(var(--border) 0 100%)";

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex size-52 items-center justify-center rounded-full" style={{ background: bg }}>
        <div className="flex size-36 flex-col items-center justify-center rounded-full bg-(--card)">
          <span className="text-[11px] font-medium text-(--muted-foreground)">Gastado</span>
          <span className="text-2xl font-extrabold tracking-tight">{formatMoney(total)}</span>
        </div>
      </div>
      <ul className="mt-4 w-full space-y-2">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 rounded-full" style={{ background: s.color ?? FALLBACK[i % FALLBACK.length] }} />
            <span className="flex-1 font-medium">{s.label}</span>
            <span className="font-bold">{formatMoney(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

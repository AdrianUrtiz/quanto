import { formatMoney } from "@/lib/utils";

export function ActivityChart({ daily }: { daily: { day: number; total: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.total));
  // Eje: días 1, 8, 16, 23, 30
  const ticks = [1, 8, 16, 23, 30];
  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {daily.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1">
            <div
              title={`${d.day}: ${formatMoney(d.total)}`}
              className="bar-anim w-full max-w-3 rounded-full bg-(--primary)/80"
              style={{ height: `${Math.max(4, (d.total / max) * 100)}%`, opacity: d.total > 0 ? 1 : 0.25 }}
            />
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-(--muted-foreground)">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: `${((t - 1) / 30) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";

export function Pills({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition",
            value === o.value
              ? "border-transparent bg-(--foreground) text-(--background)"
              : "border-(--border) bg-(--card) text-(--muted-foreground)",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

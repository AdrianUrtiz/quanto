import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-4 text-sm outline-none placeholder:text-(--muted-foreground) focus:border-(--primary)",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn("flex min-h-20 w-full rounded-2xl border border-(--border) bg-(--muted)/50 px-4 py-3 text-sm outline-none focus:border-(--primary)", className)}
      {...props}
    />
  );
}

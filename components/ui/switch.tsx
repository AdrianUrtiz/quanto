"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitives.Root>) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-(--muted) border border-(--border) transition data-[state=checked]:bg-(--primary) outline-none",
        className
      )}
      {...props}
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow transition-transform translate-x-0.5 data-[state=checked]:translate-x-[22px]" />
    </SwitchPrimitives.Root>
  );
}

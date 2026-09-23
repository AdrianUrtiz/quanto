"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/lib/use-back-to-close";

/** Drawer inferior estilo app móvil: entra deslizando desde abajo. */
export function BottomSheet({
  open, onOpenChange, children, className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  useBackToClose(open, () => onOpenChange(false));
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <DialogPrimitive.Content
          className={cn(
            "animate-sheet-up fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-4xl border-t border-x border-(--border) bg-(--card) shadow-2xl outline-none",
            className
          )}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-(--border)" />
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

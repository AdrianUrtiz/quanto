"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useKeyboardOffset } from "@/lib/use-keyboard";

/** Lleva el campo enfocado a zona visible dentro del scroll del sheet. */
function scrollFieldIntoView(target: EventTarget | null, root: HTMLElement | null) {
  if (!(target instanceof HTMLElement) || !root) return;
  const tag = target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
  // Espera a que el teclado termine de abrir antes de medir.
  setTimeout(() => {
    const scroller = target.closest(".overflow-y-auto");
    if (scroller && root.contains(scroller)) {
      const r = target.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      scroller.scrollBy({ top: r.top - sr.top - 88, behavior: "smooth" });
    } else {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, 120);
}

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
  const kb = useKeyboardOffset(open);
  const rootRef = React.useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
        <DialogPrimitive.Content
          ref={rootRef}
          onFocusCapture={(e) => scrollFieldIntoView(e.target, rootRef.current)}
          style={
            kb > 0
              ? { bottom: kb, maxHeight: `calc(94dvh - ${kb}px)` }
              : undefined
          }
          className={cn(
            "animate-sheet-up fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-4xl border-t border-x border-(--border) bg-(--card) shadow-2xl outline-none transition-[bottom,max-height] duration-200",
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

"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Contenedor deslizable genérico: al arrastrar revela las acciones de abajo.
// direction="left" (defecto): desliza a la izquierda, acciones a la derecha.
// direction="right": desliza a la derecha, acciones a la izquierda (dinero).
export function SwipeRow({
  open,
  onOpenChange,
  actions,
  actionsWidth = 152,
  disabled,
  direction = "left",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: React.ReactNode;
  actionsWidth?: number;
  disabled?: boolean;
  direction?: "left" | "right";
  children: React.ReactNode;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [isClosed, setIsClosed] = useState(!open);
  const start = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);
  const THRESHOLD = 48;
  const sign = direction === "right" ? 1 : -1;

  // Si se abre otra fila, esta se cierra.
  useEffect(() => {
    if (!open) {
      setX(0);
    } else {
      setIsClosed(false);
    }
  }, [open ]);

  function close() {
    setX(0);
    onOpenChange(false);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    setIsClosed(false);
    moved.current = false;
    start.current = { x: e.clientX, base: x };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 8) moved.current = true;
    const raw = s.base + dx;
    setX(sign === 1 ? Math.max(0, Math.min(actionsWidth, raw)) : Math.max(-actionsWidth, Math.min(0, raw)));
  }

  function onPointerUp() {
    start.current = null;
    setDragging(false);
    if (sign * x >= THRESHOLD) {
      setX(sign * actionsWidth);
      onOpenChange(true);
    } else {
      setX(0);
      onOpenChange(false);
    }
  }

  function onClickCapture() {
    // El click que cierra el arrastre no debe propagarse.
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (open) close();
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-(--muted)/40">
      {/* Acciones debajo */}
      <div
        className={cn(
          "absolute inset-y-0 flex items-center gap-2 p-2 transition-opacity duration-150",
          direction === "right" ? "left-0 justify-start" : "right-0 justify-end",
          isClosed && "pointer-events-none opacity-0",
        )}
        style={{ width: actionsWidth }}
      >
        {actions}
      </div>

      {/* Frente deslizable */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && x === 0) {
            setIsClosed(true);
          }
        }}
        className={cn("relative", !dragging && "transition-transform duration-200 ease-out")}
        style={{ transform: `translateX(${x}px)`, touchAction: "pan-y" }}
      >
        {children}
      </div>
    </div>
  );
}

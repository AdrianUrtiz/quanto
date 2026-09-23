"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Contenedor deslizable genérico: al arrastrar a la izquierda revela las
// acciones de abajo. Mismo gesto y estilo en cuentas y suscripciones.
export function SwipeRow({
  open,
  onOpenChange,
  actions,
  actionsWidth = 152,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: React.ReactNode;
  actionsWidth?: number;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [isClosed, setIsClosed] = useState(!open);
  const start = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);
  const THRESHOLD = 48;

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
    setX(Math.max(-actionsWidth, Math.min(0, s.base + dx)));
  }

  function onPointerUp() {
    start.current = null;
    setDragging(false);
    if (x <= -THRESHOLD) {
      setX(-actionsWidth);
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
          "absolute inset-y-0 right-0 flex items-center justify-end gap-2 p-2 transition-opacity duration-150",
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

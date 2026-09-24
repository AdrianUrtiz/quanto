"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Contenedor deslizable genérico: al arrastrar revela las acciones de abajo.
// - `actions`: lado derecho, se revela deslizando a la izquierda (gestionar).
// - `leftActions`: lado izquierdo, se revela deslizando a la derecha (dinero).
// `direction` limita el gesto ("left" | "right" | "both"); por defecto permite
// los lados que tengan acciones.
export function SwipeRow({
  open,
  onOpenChange,
  actions,
  actionsWidth = 152,
  leftActions,
  leftActionsWidth = 132,
  disabled,
  direction,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: React.ReactNode;
  actionsWidth?: number;
  leftActions?: React.ReactNode;
  leftActionsWidth?: number;
  disabled?: boolean;
  direction?: "left" | "right" | "both";
  children: React.ReactNode;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);
  const THRESHOLD = 48;

  const allowLeft = actions != null && direction !== "right";
  const allowRight = leftActions != null && direction !== "left";
  const minX = allowLeft ? -actionsWidth : 0;
  const maxX = allowRight ? leftActionsWidth : 0;

  // Si se abre otra fila, esta se cierra. Se ajusta durante el render
  // (patrón recomendado por React en vez de setState dentro de un efecto).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) setX(0);
    else if (x !== 0) setX(x > 0 ? maxX : minX);
  }

  // Acciones ocultas cuando el frente está en reposo (derivado, sin estado).
  const closed = x === 0;

  function close() {
    setX(0);
    onOpenChange(false);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    moved.current = false;
    start.current = { x: e.clientX, base: x };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 6) moved.current = true;
    setX(Math.max(minX, Math.min(maxX, s.base + dx)));
  }

  function onPointerUp() {
    start.current = null;
    setDragging(false);
    if (maxX > 0 && x >= THRESHOLD) {
      setX(maxX);
      onOpenChange(true);
    } else if (minX < 0 && x <= -THRESHOLD) {
      setX(minX);
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
      {/* Acciones derechas (gesto a la izquierda) */}
      {actions != null && (
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end gap-2 p-2 transition-[opacity,visibility] duration-150",
            (closed || x > 0) && "pointer-events-none opacity-0 invisible",
          )}
          style={{ width: actionsWidth }}
        >
          {actions}
        </div>
      )}

      {/* Acciones izquierdas (gesto a la derecha) */}
      {leftActions != null && (
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-start gap-2 p-2 transition-[opacity,visibility] duration-150",
            (closed || x < 0) && "pointer-events-none opacity-0 invisible",
          )}
          style={{ width: leftActionsWidth }}
        >
          {leftActions}
        </div>
      )}

      {/* Frente deslizable con fondo sólido para que las acciones nunca se trasluzcan */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        className={cn(
          "relative rounded-3xl bg-(--card)",
          !dragging && "transition-transform duration-200 ease-out",
        )}
        style={{ transform: `translateX(${x}px)`, touchAction: "pan-y" }}
      >
        {children}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";

const THRESHOLD_PX = 120;

/** Altura del teclado en px (0 si está cerrado). */
export function useKeyboardOffset(enabled: boolean): number {
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = window.innerHeight - vv.height - vv.offsetTop;
      setOffset(kb > THRESHOLD_PX ? Math.round(kb) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);
  return offset;
}

/** True mientras el teclado del teléfono está abierto. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setOpen(window.innerHeight - vv.height - vv.offsetTop > THRESHOLD_PX);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return open;
}

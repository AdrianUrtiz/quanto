"use client";

import { useEffect, useRef } from "react";

// Captura el botón "atrás" (Android / gesto iOS) para cerrar modales en vez
// de salir de la app. Cada capa abierta apila una entrada en el historial;
// el `popstate` cierra solo la superior. Al cerrar por UI se consume la
// entrada propia sin tocar las capas de abajo.

type Layer = { id: number; close: () => void };

const stack: Layer[] = [];
let nextId = 1;
let wired = false;
let suppressNextPop = false;

function ensureWired() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("popstate", () => {
    if (suppressNextPop) {
      suppressNextPop = false;
      return;
    }
    const top = stack[stack.length - 1];
    if (top) top.close();
  });
}

export function useBackToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    ensureWired();
    const id = nextId++;
    window.history.pushState({ quantoLayer: id }, "");
    const layer: Layer = { id, close: () => closeRef.current() };
    stack.push(layer);
    return () => {
      const i = stack.indexOf(layer);
      if (i !== -1) stack.splice(i, 1);
      // Cierre por UI: la entrada sigue siendo la actual → consumirla en
      // silencio. Si fue por `popstate`, el navegador ya la quitó y no se toca nada.
      const st = window.history.state as { quantoLayer?: number } | null;
      if (st && st.quantoLayer === id) {
        suppressNextPop = true;
        window.history.back();
      }
    };
  }, [open ]);
}

"use client";

import * as React from "react";

const THRESHOLD_PX = 100;

function isEditable(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }
  return el.isContentEditable;
}

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

/** True mientras el teclado del teléfono está abierto o se edita un campo de texto. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = React.useState(false);
  const baselineHeightRef = React.useRef(0);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // Altura base de referencia inicial de la ventana visible
    baselineHeightRef.current = Math.max(
      window.innerHeight,
      window.visualViewport?.height ?? 0,
    );

    let blurTimer: ReturnType<typeof setTimeout> | null = null;

    const update = () => {
      const vv = window.visualViewport;
      const currentHeight = vv ? vv.height : window.innerHeight;
      const active = document.activeElement;
      const isInputActive = isEditable(active);

      // Si no hay input activo y la ventana creció (orientación o scroll que oculta la barra URL),
      // actualizamos la altura base de referencia.
      if (!isInputActive && currentHeight > baselineHeightRef.current) {
        baselineHeightRef.current = currentHeight;
      }

      // 1. Android (interactive-widget=resizes-content):
      //    window.innerHeight y vv.height se encogen respecto a la altura base.
      const isShrunkByBaseline =
        baselineHeightRef.current - currentHeight > THRESHOLD_PX;

      // 2. iOS Safari (interactive-widget no soportado):
      //    window.innerHeight no cambia pero vv.height se encoge por el teclado.
      const isShrunkIos = vv
        ? window.innerHeight - vv.height > THRESHOLD_PX
        : false;

      // 3. API VirtualKeyboard en Chromium / Android si está disponible
      const vk = (
        navigator as unknown as {
          virtualKeyboard?: { boundingRect?: DOMRect };
        }
      )?.virtualKeyboard;
      const isVkOpen = Boolean(
        vk?.boundingRect && vk.boundingRect.height > THRESHOLD_PX,
      );

      // 4. Elemento de texto activo (inmediato, sin esperar la animación del teclado)
      const isOpen =
        isInputActive || isShrunkByBaseline || isShrunkIos || isVkOpen;

      setOpen(isOpen);
    };

    const onFocusChange = () => {
      if (blurTimer) clearTimeout(blurTimer);
      update();
      // Pequeño retardo tras focusout para evitar parpadeo si el foco pasa a otro input
      blurTimer = setTimeout(update, 60);
    };

    update();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
    window.addEventListener("focusin", onFocusChange);
    window.addEventListener("focusout", onFocusChange);

    const vk = (navigator as unknown as { virtualKeyboard?: EventTarget })
      ?.virtualKeyboard;
    if (vk && "addEventListener" in vk) {
      vk.addEventListener("geometrychange", update);
    }

    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
      window.removeEventListener("focusin", onFocusChange);
      window.removeEventListener("focusout", onFocusChange);
      if (vk && "removeEventListener" in vk) {
        vk.removeEventListener("geometrychange", update);
      }
    };
  }, []);

  return open;
}

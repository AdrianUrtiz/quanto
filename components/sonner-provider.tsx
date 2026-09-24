"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

/** Toasts globales: compactos y adaptados para vista móvil (estilo cápsula). */
export function SonnerProvider() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === "light" ? "light" : "dark"}
      richColors
      closeButton={false}
      duration={2500}
      gap={6}
      offset="calc(env(safe-area-inset-top, 0px) + 12px)"
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
    />
  );
}

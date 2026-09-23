"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

/** Toasts globales: `import { toast } from "sonner"` y listo. */
export function SonnerProvider() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={resolvedTheme === "light" ? "light" : "dark"}
      richColors
      closeButton={false}
      duration={3200}
      gap={8}
    />
  );
}

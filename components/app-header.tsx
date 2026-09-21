"use client";

import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Moon, Settings, Sun, LogOut, ChevronDown } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { theme, setTheme } = useTheme();
  const { data } = useSession();
  const [menu, setMenu] = useState(false);
  const dark = theme === "dark";

  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-(--border) bg-(--background)/90 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3">
        <div className="relative">
          <button
            onClick={() => setMenu((v) => !v)}
            aria-label="Configuración"
            className="flex size-10 items-center justify-center rounded-full bg-(--muted) text-(--foreground)"
          >
            <Settings className="size-5" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div className="absolute left-0 top-12 z-50 w-56 overflow-hidden rounded-2xl border border-(--border) bg-(--card) shadow-xl">
                <button
                  onClick={() => { setTheme(dark ? "light" : "dark"); setMenu(false); }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium hover:bg-(--muted)"
                >
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {dark ? "Modo claro" : "Modo oscuro"}
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-red-500 hover:bg-(--muted)"
                >
                  <LogOut className="size-4" /> Cerrar sesión
                </button>
                {data?.user?.email && (
                  <p className="truncate border-t border-(--border) px-4 py-2 text-[11px] text-(--muted-foreground)">
                    {data.user.email}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 text-sm font-semibold">
          {title} <ChevronDown className="size-4 text-(--muted-foreground)" />
          {subtitle && <span className="ml-1 font-normal text-(--muted-foreground)">{subtitle}</span>}
        </div>

        <button
          onClick={() => setTheme(dark ? "light" : "dark")}
          aria-label="Cambiar tema"
          className="flex size-10 items-center justify-center rounded-full bg-(--muted)"
        >
          {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
      </div>
    </header>
  );
}

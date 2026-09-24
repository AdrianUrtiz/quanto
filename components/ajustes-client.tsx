"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Moon,
  Shapes,
  Sun,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { BottomSheet } from "@/components/bottom-sheet";
import { PasswordForm } from "@/components/password-form";
import { cn } from "@/lib/utils";

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: MonitorSmartphone },
];

export function AjustesClient({ username }: { username?: string }) {
  const { theme, setTheme } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pt-4">
      <div>
        <p className="text-sm font-medium text-(--muted-foreground) mb-1">Ajustes</p>
        <p className="truncate text-4xl font-extrabold tracking-tight">
          Tu cuenta
        </p>
        {username && (
          <p className="mt-1 truncate text-xs font-medium text-(--muted-foreground) uppercase">
            @{username}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        {/* Tema de la aplicación */}
        <section className="space-y-2 rounded-3xl border border-(--border) p-4 w-full">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            Tema de la aplicación
          </p>
          <div className="grid grid-cols-3 gap-2 rounded-full bg-(--muted) p-1">
            {THEMES.map((t) => {
              const Icon = t.icon;
              const active = theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition",
                    active ? "bg-(--card) shadow" : "text-(--muted-foreground)",
                  )}
                >
                  <Icon className="size-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Categorías */}
        <Link
          href="/categorias"
          className="flex items-center gap-3 rounded-3xl border border-(--border) p-4 transition active:scale-[.99]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted)">
            <Shapes className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Categorías</span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              Personaliza tu catálogo
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-(--muted-foreground)" />
        </Link>

        {/* Cambiar contraseña */}
        <button
          type="button"
          onClick={() => setPwOpen(true)}
          className="flex w-full items-center gap-3 rounded-3xl border border-(--border) p-4 text-left transition active:scale-[.99]"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted)">
            <KeyRound className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Cambiar contraseña
            </span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              Actual, nueva y confirmación
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-(--muted-foreground)" />
        </button>

        <BottomSheet open={pwOpen} onOpenChange={setPwOpen}>
          <PasswordForm onDone={() => setPwOpen(false)} />
        </BottomSheet>

        {/* Cerrar sesión */}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border border-red-500/30 p-4 text-sm font-semibold text-red-500 transition active:scale-[.99]"
        >
          <LogOut className="size-4" /> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

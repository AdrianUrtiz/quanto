"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Landmark, Plus, Repeat } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { useBackToClose } from "@/lib/use-back-to-close";
import {
  TransactionForm,
  type AccountOpt,
} from "@/components/transaction-form";
import { AccountForm } from "@/components/account-form";
import { SubscriptionForm } from "@/components/subscription-form";
import type { CatalogRow } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const FAB_CLS =
  "fixed right-5 bottom-24 z-40 flex size-14 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) shadow-2xl transition active:scale-95";

type FabProps = {
  accountOptions: AccountOpt[];
  cats: CatalogRow[];
};

export function Fab({ accountOptions, cats }: FabProps) {
  const pathname = usePathname();

  // Resumen, Ajustes y Categorías: sin botón flotante.
  if (
    pathname.startsWith("/resumen") ||
    pathname.startsWith("/ajustes") ||
    pathname.startsWith("/categorias")
  )
    return null;

  // Cuentas: speed-dial con dos acciones (cuenta / suscripción).
  // `key` por ruta: al navegar y volver, el menú se remonta y arranca cerrado.
  if (pathname.startsWith("/cuentas")) {
    return (
      <CuentasSpeedDial
        key={pathname}
        accountOptions={accountOptions}
        cats={cats}
      />
    );
  }

  // Actividad (y resto): drawer de movimiento.
  return <TxFab accountOptions={accountOptions} cats={cats} />;
}

function CuentasSpeedDial({ accountOptions, cats }: FabProps) {
  const [expanded, setExpanded] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  useBackToClose(expanded, () => setExpanded(false));

  return (
    <>
      <button
        aria-hidden
        tabIndex={-1}
        onClick={() => setExpanded(false)}
        className={cn(
          "fixed inset-0 z-40 cursor-default bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          expanded ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div className="fixed right-5 bottom-24 z-50 flex flex-col items-end gap-3">
        <div
          className={cn(
            "flex flex-col items-end gap-3 transition-all duration-200",
            expanded
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <button
            onClick={() => {
              setExpanded(false);
              setAccountOpen(true);
            }}
            aria-label="Añadir cuenta"
            className="flex cursor-pointer items-center justify-end gap-2"
          >
            <span className="rounded-full border border-(--border) bg-(--card) px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-lg">
              Cuenta
            </span>
            <span className="mr-1 flex size-12 items-center justify-center rounded-full border border-(--border) bg-(--card) shadow-xl transition active:scale-95">
              <Landmark className="size-5" />
            </span>
          </button>
          <button
            onClick={() => {
              setExpanded(false);
              setSubOpen(true);
            }}
            aria-label="Añadir suscripción"
            className="flex cursor-pointer items-center justify-end gap-2"
          >
            <span className="rounded-full border border-(--border) bg-(--card) px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap shadow-lg">
              Suscripción
            </span>
            <span className="mr-1 flex size-12 items-center justify-center rounded-full border border-(--border) bg-(--card) shadow-xl transition active:scale-95">
              <Repeat className="size-5" />
            </span>
          </button>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={
            expanded ? "Cerrar opciones" : "Agregar cuenta o suscripción"
          }
          aria-expanded={expanded}
          className={cn(FAB_CLS, "relative right-auto bottom-auto")}
        >
          <Plus
            className={cn(
              "size-7 transition-transform duration-200",
              expanded && "rotate-45",
            )}
          />
        </button>
      </div>
      <BottomSheet open={accountOpen} onOpenChange={setAccountOpen}>
        <AccountForm onDone={() => setAccountOpen(false)} />
      </BottomSheet>
      <BottomSheet open={subOpen} onOpenChange={setSubOpen}>
        <SubscriptionForm
          accountOptions={accountOptions}
          cats={cats}
          onDone={() => setSubOpen(false)}
        />
      </BottomSheet>
    </>
  );
}

function TxFab({ accountOptions, cats }: FabProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Registrar movimiento"
        className={FAB_CLS}
      >
        <Plus className="size-7" />
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <TransactionForm
          accountOptions={accountOptions}
          cats={cats}
          onDone={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  );
}

"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { TransactionForm, type AccountOpt } from "@/components/transaction-form";
import type { CatalogRow } from "@/lib/catalog";

export function Fab({ accountOptions, cats }: { accountOptions: AccountOpt[]; cats: CatalogRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Registrar movimiento"
        className="fixed right-5 bottom-28 z-40 flex size-14 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) shadow-2xl transition active:scale-95"
      >
        <Plus className="size-7" />
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <TransactionForm accountOptions={accountOptions} cats={cats} onDone={() => setOpen(false)} />
      </BottomSheet>
    </>
  );
}

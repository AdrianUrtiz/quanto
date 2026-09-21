"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TransactionForm, type AccountOpt } from "@/components/transaction-form";

export function Fab({ accountOptions }: { accountOptions: AccountOpt[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          aria-label="Registrar gasto"
          className="fixed right-5 bottom-28 z-40 flex size-14 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) shadow-2xl transition active:scale-95"
        >
          <Plus className="size-7" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
        </DialogHeader>
        <TransactionForm accountOptions={accountOptions} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

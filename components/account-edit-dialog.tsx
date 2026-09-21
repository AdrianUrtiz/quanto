"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AccountForm, type AccountEditData } from "@/components/account-form";

export function AccountEditDialog({ account }: { account: AccountEditData }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          aria-label={`Editar ${account.name}`}
          className="shrink-0 rounded-full p-1.5 text-(--muted-foreground) transition hover:bg-(--muted) hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cuenta</DialogTitle>
        </DialogHeader>
        <AccountForm account={account} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AccountForm } from "@/components/account-form";
import { AccountCard, type AccountRow } from "@/components/account-card";
import { SwipeRow } from "@/components/swipe-row";
import { deleteAccount } from "@/lib/actions";

export function AccountSwipeRow({
  a, open, onOpenChange,
}: {
  a: AccountRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function close() {
    onOpenChange(false);
  }

  async function doDelete() {
    setDelError(null);
    setDeleting(true);
    const res = await deleteAccount(a.id);
    setDeleting(false);
    if ("error" in res && res.error) setDelError(res.error);
    else setConfirmOpen(false);
  }

  return (
    <>
      <SwipeRow
        open={open}
        onOpenChange={onOpenChange}
        disabled={editOpen || confirmOpen}
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                close();
                setEditOpen(true);
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-foreground shadow-xs transition-all hover:bg-(--muted) active:scale-95"
            >
              <Pencil className="size-4 text-foreground" />
              <span>Editar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                close();
                setDelError(null);
                setConfirmOpen(true);
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-red-500 text-xs font-semibold text-white shadow-xs transition-all hover:bg-red-600 active:scale-95"
            >
              <Trash2 className="size-4" />
              <span>Eliminar</span>
            </button>
          </>
        }
      >
        <AccountCard a={a} />
      </SwipeRow>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar cuenta</DialogTitle>
          </DialogHeader>
          <AccountForm account={a} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar {a.name}?</DialogTitle>
            <DialogDescription>
              Se ocultará de tus cuentas, pero se conserva el historial de movimientos.
            </DialogDescription>
          </DialogHeader>
          {delError && <p className="text-sm font-medium text-red-500">{delError}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="flex-1" disabled={deleting} onClick={doDelete}>
              {deleting ? "Eliminando…" : "Sí, eliminar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

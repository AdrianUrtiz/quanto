"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BottomSheet } from "@/components/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TransactionForm, type AccountOpt } from "@/components/transaction-form";
import type { CatalogRow } from "@/lib/catalog";
import { TransactionRow, type TxRow } from "@/components/transaction-list";
import { deleteTransaction } from "@/lib/actions";
import { formatMoney } from "@/lib/utils";
import { cn } from "@/lib/utils";

const REVEAL = 152; // dos acciones con espaciado
const THRESHOLD = 48; // desplazamiento para fijar abierto

export function TransactionSwipeRow({
  t, accountOptions, cats, open, onOpenChange,
}: {
  t: TxRow;
  accountOptions: AccountOpt[];
  cats: CatalogRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [isClosed, setIsClosed] = useState(!open);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const start = useRef<{ x: number; base: number } | null>(null);
  const moved = useRef(false);

  // Si se abre otra fila, esta se cierra.
  useEffect(() => {
    if (!open) {
      setX(0);
    } else {
      setIsClosed(false);
    }
  }, [open ]);

  function close() {
    setX(0);
    onOpenChange(false);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editOpen || confirmOpen) return;
    setIsClosed(false);
    moved.current = false;
    start.current = { x: e.clientX, base: x };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 8) moved.current = true;
    setX(Math.max(-REVEAL, Math.min(0, s.base + dx)));
  }

  function onPointerUp() {
    start.current = null;
    setDragging(false);
    if (x <= -THRESHOLD) {
      setX(-REVEAL);
      onOpenChange(true);
    } else {
      setX(0);
      onOpenChange(false);
    }
  }

  function onClickCapture() {
    // El click que cierra el arrastre no debe propagarse.
    if (moved.current) {
      moved.current = false;
      return;
    }
    if (open) close();
  }

  async function doDelete() {
    setDelError(null);
    setDeleting(true);
    const res = await deleteTransaction(t.id);
    setDeleting(false);
    if ("error" in res && res.error) {
      setDelError(res.error);
      toast.error(res.error);
    } else {
      setConfirmOpen(false);
      toast.success("Movimiento eliminado");
      router.refresh();
    }
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-3xl bg-(--muted)/40">
        {/* Acciones debajo */}
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex w-38 items-center justify-end gap-2 p-2 transition-opacity duration-150",
            isClosed && "pointer-events-none opacity-0"
          )}
        >
          <button
            type="button"
            onClick={() => {
              close();
              setEditOpen(true);
            }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-(--foreground) shadow-xs transition-all hover:bg-(--muted) active:scale-95"
          >
            <Pencil className="size-4 text-(--foreground)" />
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
        </div>

        {/* Frente deslizable */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget && x === 0) {
              setIsClosed(true);
            }
          }}
          className={cn("relative", !dragging && "transition-transform duration-200 ease-out")}
          style={{ transform: `translateX(${x}px)`, touchAction: "pan-y" }}
        >
          <TransactionRow t={t} cats={cats} />
        </div>
      </div>

      <BottomSheet open={editOpen} onOpenChange={setEditOpen}>
        <TransactionForm accountOptions={accountOptions} cats={cats} entry={t} onDone={() => setEditOpen(false)} />
      </BottomSheet>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar {t.concept}?</DialogTitle>
            <DialogDescription>
              Se revertirá su efecto ({formatMoney(t.amount)}) en el saldo de {t.accountName}.
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

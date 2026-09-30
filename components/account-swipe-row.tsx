'use client'

import { useState } from 'react'

import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { AccountCard, type AccountRow } from '@/components/account-card'
import { AccountForm } from '@/components/account-form'
import { AccountMoneySheet } from '@/components/account-money-sheet'
import { BottomSheet } from '@/components/bottom-sheet'
import { SwipeRow } from '@/components/swipe-row'
import type { AccountOpt } from '@/components/transaction-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { deleteAccount, setAccountHidden } from '@/lib/actions'

export function AccountSwipeRow({
  a,
  open,
  onOpenChange,
  debitOptions = [],
}: {
  a: AccountRow
  open: boolean
  onOpenChange: (open: boolean) => void
  debitOptions?: AccountOpt[]
}) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [hiding, setHiding] = useState(false)

  function close() {
    onOpenChange(false)
  }

  async function doHide() {
    close()
    setHiding(true)
    const res = await setAccountHidden(a.id, true)
    setHiding(false)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Cuenta oculta')
      router.refresh()
    }
  }

  async function doDelete() {
    setDelError(null)
    setDeleting(true)
    const res = await deleteAccount(a.id)
    setDeleting(false)
    if ('error' in res && res.error) {
      setDelError(res.error)
      toast.error(res.error)
    } else {
      setConfirmOpen(false)
      toast.success('Cuenta eliminada')
      router.refresh()
    }
  }

  return (
    <>
      <SwipeRow
        open={open}
        onOpenChange={onOpenChange}
        disabled={editOpen || confirmOpen || payOpen || hiding}
        actionsWidth={224}
        leftActionsWidth={80}
        leftActions={
          a.type === 'CREDIT' ? (
            <button
              type="button"
              onClick={() => {
                close()
                setPayOpen(true)
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-(--foreground) text-xs font-semibold text-(--background) shadow-xs transition-all active:scale-95">
              <ArrowUpRight className="size-4" />
              <span>Pagar</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                close()
                setPayOpen(true)
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 text-xs font-semibold text-white shadow-xs transition-all active:scale-95">
              <ArrowDownLeft className="size-4" />
              <span>Abonar</span>
            </button>
          )
        }
        actions={
          <>
            <button
              type="button"
              onClick={doHide}
              disabled={hiding}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-(--foreground) shadow-xs transition-all hover:bg-(--muted) active:scale-95 disabled:opacity-50">
              <EyeOff className="size-4 text-(--foreground)" />
              <span>{hiding ? '…' : 'Ocultar'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                close()
                setEditOpen(true)
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-(--foreground) shadow-xs transition-all hover:bg-(--muted) active:scale-95">
              <Pencil className="size-4 text-(--foreground)" />
              <span>Editar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                close()
                setDelError(null)
                setConfirmOpen(true)
              }}
              className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-red-500 text-xs font-semibold text-white shadow-xs transition-all hover:bg-red-600 active:scale-95">
              <Trash2 className="size-4" />
              <span>Eliminar</span>
            </button>
          </>
        }>
        <AccountCard a={a} />
      </SwipeRow>

      <BottomSheet open={editOpen} onOpenChange={setEditOpen}>
        <AccountForm account={a} onDone={() => setEditOpen(false)} />
      </BottomSheet>

      <BottomSheet open={payOpen} onOpenChange={setPayOpen}>
        <AccountMoneySheet
          key={a.id}
          account={a}
          sourceOptions={debitOptions.filter((d) => d.id !== a.id)}
          onDone={() => {
            setPayOpen(false)
            router.refresh()
          }}
        />
      </BottomSheet>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar {a.name}?</DialogTitle>
            <DialogDescription>
              Se ocultará de tus cuentas, pero se conserva el historial de
              movimientos.
            </DialogDescription>
          </DialogHeader>
          {delError && (
            <p className="text-sm font-medium text-red-500">{delError}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={deleting}
              onClick={doDelete}>
              {deleting ? 'Eliminando…' : 'Sí, eliminar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Fila de cuenta oculta: swipe con un solo botón Mostrar. */
export function HiddenAccountSwipeRow({
  a,
  open,
  onOpenChange,
}: {
  a: AccountRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [showing, setShowing] = useState(false)

  async function doShow() {
    onOpenChange(false)
    setShowing(true)
    const res = await setAccountHidden(a.id, false)
    setShowing(false)
    if ('error' in res && res.error) toast.error(res.error)
    else {
      toast.success('Cuenta visible')
      router.refresh()
    }
  }

  return (
    <SwipeRow
      open={open}
      onOpenChange={onOpenChange}
      disabled={showing}
      actionsWidth={80}
      actions={
        <button
          type="button"
          onClick={doShow}
          disabled={showing}
          className="flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border) bg-(--card) text-xs font-semibold text-(--foreground) shadow-xs transition-all hover:bg-(--muted) active:scale-95 disabled:opacity-50">
          <Eye className="size-4 text-(--foreground)" />
          <span>{showing ? '…' : 'Mostrar'}</span>
        </button>
      }>
      <AccountCard a={a} />
    </SwipeRow>
  )
}

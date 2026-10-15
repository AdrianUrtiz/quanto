'use client'

import { useEffect, useState } from 'react'

import { ArrowLeft, Check, Pencil, Plus, Trash2, User, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  addGroupSeat,
  removeGroupSeat,
  renameGroupSeat,
} from '@/lib/group-actions'
import { syncForce } from '@/lib/offline/useSnapshotSync'
import { cn } from '@/lib/utils'

export type GroupMemberRow = {
  id: string
  displayName: string
  occupied: boolean
  isMe: boolean
  occupantName: string | null
}

/** Integrantes del grupo (sin saldos): añadir, renombrar y eliminar. */
export function GroupMembersClient({
  householdId,
  groupName,
  isCreator,
  canEdit,
  members,
}: {
  householdId: string
  groupName: string
  isCreator: boolean
  /** Editar/eliminar solo sin gastos registrados (los nombres son historia). */
  canEdit: boolean
  members: GroupMemberRow[]
}) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  // Sin red no se puede modificar (server actions): se muestra la lista igual.
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  function refresh() {
    void syncForce()
    router.refresh()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    setAdding(true)
    try {
      const res = await addGroupSeat(householdId, draft)
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Integrante agregado')
        setDraft('')
        refresh()
      }
    } finally {
      setAdding(false)
    }
  }

  function startEdit(m: GroupMemberRow) {
    setConfirmDeleteId(null)
    setEditingId(m.id)
    setEditName(m.displayName)
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) {
      toast.error('Escribe un nombre (1-30 letras)')
      return
    }
    setSavingEdit(true)
    try {
      const res = await renameGroupSeat(id, editName)
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Nombre actualizado')
        setEditingId(null)
        refresh()
      }
    } finally {
      setSavingEdit(false)
    }
  }

  async function remove(id: string) {
    setBusyDelete(true)
    try {
      const res = await removeGroupSeat(id)
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Integrante eliminado')
        setConfirmDeleteId(null)
        refresh()
      }
    } finally {
      setBusyDelete(false)
    }
  }

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-center gap-2">
        <Link
          href={`/cuentas/grupos/${householdId}`}
          aria-label="Volver al grupo"
          className="flex size-9 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-extrabold tracking-tight">
            Integrantes
          </p>
          <p className="truncate text-xs text-(--muted-foreground)">
            {groupName} · {members.length}{' '}
            {members.length === 1 ? 'persona' : 'personas'}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {members.map((m) => {
          const editable = canEdit && online && !m.isMe
          const isEditing = editingId === m.id
          const confirming = confirmDeleteId === m.id
          return (
            <li key={m.id} className="rounded-3xl border border-(--border) p-3">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void saveEdit(m.id)
                      }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    maxLength={30}
                    autoComplete="off"
                    autoFocus
                    className="flex-1"
                  />
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={() => void saveEdit(m.id)}
                    aria-label="Guardar nombre"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition active:scale-95 disabled:opacity-50">
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label="Cancelar edición"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15">
                    <User className="size-4 text-sky-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {m.displayName}
                      {m.isMe && ' (tú)'}
                    </span>
                    <span className="block truncate text-xs text-(--muted-foreground)">
                      {m.occupied
                        ? (m.occupantName ?? 'Ocupado')
                        : 'Sin reclamar'}
                    </span>
                  </span>
                  {confirming ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busyDelete}
                        onClick={() => void remove(m.id)}
                        className="rounded-full bg-red-500 px-3 py-1.5 text-[11px] font-bold text-white transition active:scale-95 disabled:opacity-50">
                        {busyDelete ? '…' : 'Sí, quitar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        aria-label="Cancelar"
                        className="flex size-8 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ) : (
                    editable && (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          aria-label={`Editar a ${m.displayName}`}
                          className="flex size-8 items-center justify-center rounded-full bg-(--muted) transition active:scale-95">
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(m.id)}
                          aria-label={`Eliminar a ${m.displayName}`}
                          className="flex size-8 items-center justify-center rounded-full bg-(--muted) text-red-500 transition active:scale-95">
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    )
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {isCreator && (
        <form onSubmit={submit} className="space-y-1.5">
          <Label htmlFor="member-name">Agregar integrante</Label>
          <div className="flex gap-2">
            <Input
              id="member-name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Axel"
              maxLength={30}
              autoComplete="off"
              disabled={!online}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={adding || !draft.trim() || !online}
              title={online ? undefined : 'Sin conexión'}
              className="shrink-0">
              <Plus className="size-4" /> Añadir
            </Button>
          </div>
          <p
            className={cn(
              'text-xs text-(--muted-foreground)',
              !online && 'text-amber-500',
            )}>
            {!online
              ? 'Sin conexión: conéctate para añadir.'
              : canEdit
                ? 'Un nombre por vez. Entra como lugar libre.'
                : 'Ya hay gastos: los nombres quedan fijos, pero puedes seguir añadiendo.'}
          </p>
        </form>
      )}
    </div>
  )
}

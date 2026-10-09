'use client'

import { useState } from 'react'

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { AccountBadge } from '@/components/account-badge'
import type { AccountRow } from '@/components/account-card'
import { Button } from '@/components/ui/button'

import { reorderAccounts } from '@/lib/actions'
import { cn } from '@/lib/utils'

function SortableRow({ a }: { a: AccountRow }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: a.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) p-3 pr-4',
        isDragging && 'z-10 shadow-xl ring-2 ring-(--primary)',
      )}>
      <button
        type="button"
        aria-label={`Arrastrar ${a.name}`}
        {...attributes}
        {...listeners}
        className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-(--muted-foreground) active:cursor-grabbing">
        <GripVertical className="size-5" />
      </button>
      <AccountBadge type={a.type} color={a.color} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        {a.name}
      </span>
      <span className="shrink-0 text-[11px] text-(--muted-foreground)">
        {a.type === 'CREDIT' ? 'Crédito' : 'Débito'}
      </span>
    </li>
  )
}

/**
 * Modo reordenar: la favorita queda fija arriba (siempre primera) y el
 * resto se arrastra. En táctil se arrastra manteniendo presionado el
 * handle para no pelear con el scroll.
 */
export function AccountsReorder({
  accounts,
  onClose,
}: {
  accounts: AccountRow[]
  onClose: () => void
}) {
  const router = useRouter()
  const favorite = accounts.find((a) => a.isFavorite) ?? null
  const rest = accounts.filter((a) => a.id !== favorite?.id)
  const [order, setOrder] = useState<string[]>(rest.map((a) => a.id))
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 6 },
    }),
  )

  const byId = new Map(accounts.map((a) => [a.id, a]))
  const ordered = order
    .map((id) => byId.get(id))
    .filter((a): a is AccountRow => Boolean(a))

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const from = prev.indexOf(String(active.id))
      const to = prev.indexOf(String(over.id))
      if (from === -1 || to === -1) return prev
      return arrayMove(prev, from, to)
    })
  }

  async function save() {
    setSaving(true)
    const res = await reorderAccounts(order)
    setSaving(false)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Orden guardado')
    onClose()
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <p className="-mt-1 text-[11px] text-(--muted-foreground)">
        Mantén presionado ⠿⠿ y arrastra para ordenar · la favorita siempre va
        primera
      </p>
      {favorite && (
        <div className="flex items-center gap-3 rounded-3xl border border-amber-500/30 bg-amber-500/[0.07] p-3 pr-4">
          <span className="flex size-9 shrink-0 items-center justify-center">
            <Star className="size-5 fill-amber-400 text-amber-400" />
          </span>
          <AccountBadge type={favorite.type} color={favorite.color} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {favorite.name}
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-amber-500">
            Favorita
          </span>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {ordered.map((a) => (
              <SortableRow key={a.id} a={a} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {ordered.length < 2 && (
        <p className="rounded-3xl border border-dashed border-(--border) p-6 text-center text-sm text-(--muted-foreground)">
          Agrega otra cuenta para poder ordenar.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="secondary"
          className="h-12 flex-1 rounded-2xl"
          onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-12 flex-1 rounded-2xl"
          disabled={saving || ordered.length < 2}
          onClick={save}>
          {saving ? 'Guardando…' : 'Guardar orden'}
        </Button>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { CatalogRow } from '@/lib/catalog'
import { createGroupExpense } from '@/lib/group-actions'
import { formatMoney } from '@/lib/utils'
import { todayMexicoYMD, wallNow } from '@/lib/walltime'

export type GroupAccountOpt = { id: string; name: string }
export type GroupSeatOpt = {
  id: string
  displayName: string
  occupied: boolean
  isMe: boolean
}

/**
 * Gasto grupal (pago único, partes iguales). Solo se usa dentro del grupo:
 * el householdId viene fijado y el pagador es quien lo registra.
 */
export function GroupExpenseForm({
  householdId,
  householdName,
  accountOptions,
  seats,
  cats,
  onDone,
}: {
  householdId: string
  householdName: string
  accountOptions: GroupAccountOpt[]
  seats: GroupSeatOpt[]
  cats: CatalogRow[]
  onDone: () => void
}) {
  const router = useRouter()
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [concept, setConcept] = useState('')
  const [category, setCategory] = useState('COMIDA')
  const [dateYMD, setDateYMD] = useState(todayMexicoYMD())
  const [picked, setPicked] = useState<string[]>(() =>
    seats.filter((s) => !s.isMe).map((s) => s.id),
  )
  const [pending, setPending] = useState(false)

  const total = Number(amount) || 0
  const per = picked.length > 0 ? total / picked.length : 0

  function toggle(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!accountId) return toast.error('Elige una cuenta')
    if (!(Number(amount) > 0)) return toast.error('Monto inválido')
    if (picked.length === 0)
      return toast.error('Elige quiénes participan en el reparto')
    setPending(true)
    try {
      const now = wallNow()
      const hh = String(now.getUTCHours()).padStart(2, '0')
      const mm = String(now.getUTCMinutes()).padStart(2, '0')
      const fd = new FormData()
      fd.set('householdId', householdId)
      fd.set('accountId', accountId)
      fd.set('amount', amount)
      fd.set('concept', concept)
      fd.set('category', category)
      fd.set('date', `${dateYMD}T${hh}:${mm}`)
      for (const id of picked) fd.append('seatIds', id)
      const res = await createGroupExpense(fd)
      if ('error' in res && res.error) toast.error(res.error)
      else {
        toast.success('Gasto grupal registrado')
        onDone()
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="text-base font-extrabold">Gasto en {householdName}</p>
        <p className="text-xs text-(--muted-foreground)">
          Lo pagas tú con tu cuenta y se reparte en partes iguales.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ge-amount">Monto</Label>
          <Input
            id="ge-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ge-date">Fecha</Label>
          <Input
            id="ge-date"
            type="date"
            value={dateYMD}
            onChange={(e) => setDateYMD(e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ge-concept">Concepto</Label>
        <Input
          id="ge-concept"
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Cena, Airbnb, gasolina…"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="ge-account">Pagué con</Label>
          <select
            id="ge-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-11 w-full rounded-2xl border border-(--border) bg-(--card) px-3 text-sm font-medium outline-none">
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ge-cat">Categoría</Label>
          <select
            id="ge-cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-11 w-full rounded-2xl border border-(--border) bg-(--card) px-3 text-sm font-medium outline-none">
            {cats
              .filter((c) => c.kind === 'expense' || c.kind === 'both')
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Reparto en partes iguales</Label>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {seats.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={s.isMe}
                onClick={() => toggle(s.id)}
                aria-pressed={picked.includes(s.id)}
                className="flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition hover:bg-(--muted) disabled:opacity-50">
                <span
                  className={
                    picked.includes(s.id) || s.isMe
                      ? 'flex size-5 items-center justify-center rounded-md bg-(--primary) text-xs font-bold text-(--primary-foreground)'
                      : 'size-5 rounded-md border border-(--border)'
                  }>
                  {(picked.includes(s.id) || s.isMe) && '✓'}
                </span>
                <span className="flex-1 text-sm font-semibold">
                  {s.displayName}
                </span>
                <span className="text-xs text-(--muted-foreground)">
                  {s.isMe
                    ? 'pagas tú'
                    : !s.occupied
                      ? 'sin reclamar'
                      : picked.includes(s.id)
                        ? formatMoney(per)
                        : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {picked.length > 0 && (
          <p className="text-xs text-(--muted-foreground)">
            {formatMoney(per)} por persona · {picked.length}{' '}
            {picked.length === 1 ? 'participante' : 'participantes'}
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="h-12 w-full text-base">
        {pending ? 'Guardando…' : 'Registrar gasto'}
      </Button>
    </form>
  )
}

'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  type GroupPreview,
  claimSeat,
  createGroup,
  joinGroupAsNew,
  previewGroup,
} from '@/lib/group-actions'
import { cn } from '@/lib/utils'

/** Crear grupo: nombre + integrantes por nombre libre (uno por línea o coma). */
export function GroupCreateSheet({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [seats, setSeats] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    try {
      const fd = new FormData()
      fd.set('name', name)
      fd.set('seats', seats)
      const res = await createGroup(fd)
      if ('error' in res && res.error) {
        toast.error(res.error)
      } else if ('ok' in res) {
        toast.success('Grupo creado')
        onDone()
        router.push(`/grupos/${res.householdId}`)
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
        <p className="text-base font-extrabold">Nuevo grupo</p>
        <p className="text-xs text-(--muted-foreground)">
          Agrega a todos por nombre, aunque aún no tengan la app. Después
          comparten el código y cada quien elige quién es.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="group-name">Nombre del grupo</Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Viaje a la playa"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="group-seats">Integrantes</Label>
        <textarea
          id="group-seats"
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
          placeholder={'Brenda, Luis, Toño, Kari'}
          rows={4}
          required
          className="w-full rounded-2xl border border-(--border) bg-(--card) px-4 py-3 text-sm outline-none placeholder:text-(--muted-foreground) focus:border-(--primary)"
        />
        <p className="text-xs text-(--muted-foreground)">
          Separa por comas o líneas. Podrás agregar más después.
        </p>
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="h-12 w-full text-base">
        {pending ? 'Creando…' : 'Crear grupo'}
      </Button>
    </form>
  )
}

/** Unirse: pega G-XXXXXX → preview sin montos → ¿quién eres? → claim directo. */
export function GroupJoinSheet({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<
    (GroupPreview & { alreadyMember?: boolean }) | null
  >(null)
  const [seatId, setSeatId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault()
    if (!code.trim()) return
    setPending(true)
    try {
      const res = await previewGroup(code)
      if ('error' in res) {
        toast.error(res.error)
        setPreview(null)
      } else {
        const { householdId, name, code, memberCount, seats } = res
        setPreview({
          householdId,
          name,
          code,
          memberCount,
          seats,
          ...('alreadyMember' in res ? { alreadyMember: true as const } : {}),
        })
        setSeatId(null)
      }
    } finally {
      setPending(false)
    }
  }

  async function join() {
    if (!preview) return
    setPending(true)
    try {
      const res = seatId
        ? await claimSeat(seatId)
        : await joinGroupAsNew(preview.code)
      if ('error' in res && res.error) {
        toast.error(res.error)
      } else {
        toast.success(seatId ? 'Te uniste al grupo' : 'Te uniste con tu nombre')
        onDone()
        router.push(`/grupos/${preview.householdId}`)
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="text-base font-extrabold">Unirse a un grupo</p>
        <p className="text-xs text-(--muted-foreground)">
          Pega el código que te compartieron (G-XXXXXX).
        </p>
      </div>
      {!preview ? (
        <form onSubmit={lookup} className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="G-XXXXXX"
            autoComplete="off"
            className="flex-1 uppercase"
          />
          <Button type="submit" disabled={pending || !code.trim()}>
            Ver
          </Button>
        </form>
      ) : (
        <>
          <div className="rounded-2xl bg-(--muted) p-4 text-center">
            <p className="text-lg font-extrabold">{preview.name}</p>
            <p className="text-xs text-(--muted-foreground)">
              {preview.memberCount}{' '}
              {preview.memberCount === 1 ? 'integrante' : 'integrantes'}
            </p>
          </div>
          {'alreadyMember' in preview && preview.alreadyMember ? (
            <Button
              type="button"
              onClick={() => {
                onDone()
                router.push(`/grupos/${preview.householdId}`)
              }}>
              Entrar al grupo
            </Button>
          ) : (
            <>
              <p className="text-sm font-bold">¿Quién eres?</p>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {preview.seats.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={s.occupied}
                      onClick={() => setSeatId(s.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-2xl px-4 py-2.5 text-left transition',
                        s.occupied ? 'opacity-40' : 'hover:bg-(--muted)',
                        seatId === s.id && 'bg-(--muted)',
                      )}>
                      <span className="flex-1 text-sm font-semibold">
                        {s.displayName}
                      </span>
                      <span className="text-xs text-(--muted-foreground)">
                        {s.occupied
                          ? 'Ocupado'
                          : seatId === s.id
                            ? 'Elegido'
                            : 'Libre'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                disabled={pending}
                variant={seatId ? 'default' : 'secondary'}
                onClick={join}
                className="h-12 w-full text-base">
                {pending
                  ? 'Uniendo…'
                  : seatId
                    ? 'Soy esta persona'
                    : 'No estoy en la lista, entrar con mi nombre'}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null)
                  setCode('')
                }}
                className="text-xs font-semibold text-(--muted-foreground)">
                Usar otro código
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

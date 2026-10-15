'use client'

import { useState } from 'react'

import { Check, Copy, Plus, Share2, X } from 'lucide-react'
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

function cleanSeatName(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, ' ')
  if (v.length < 1 || v.length > 30) return null
  return v
}

/** Crear grupo: nombre + integrantes uno por uno, con confirmación grande. */
export function GroupCreateSheet({
  myName,
}: {
  /** Nombre del usuario actual: entra en la lista por defecto, bloqueado. */
  myName: string
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  // El creador siempre es parte: primer lugar de la lista, no eliminable.
  const [seats, setSeats] = useState<string[]>([myName.trim() || 'Yo'])
  const [pending, setPending] = useState(false)
  const [created, setCreated] = useState<{
    householdId: string
    code: string
    groupName: string
  } | null>(null)

  function addSeat() {
    const clean = cleanSeatName(draft)
    if (!clean) {
      if (draft.trim()) toast.error('Nombre inválido (1-30 letras)')
      return
    }
    const dupIdx = seats.findIndex(
      (s) => s.toLowerCase() === clean.toLowerCase(),
    )
    if (dupIdx >= 0) {
      toast.error(
        dupIdx === 0
          ? 'Ya estás en la lista'
          : 'Ese nombre ya está en la lista',
      )
      return
    }
    if (seats.length >= 50) {
      toast.error('Máximo 50 integrantes por grupo')
      return
    }
    setSeats((prev) => [...prev, clean])
    setDraft('')
  }

  function removeSeat(idx: number) {
    // El lugar 0 es el creador: no se puede quitar.
    if (idx === 0) return
    setSeats((prev) => prev.filter((_, i) => i !== idx))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (seats.length < 2) {
      toast.error('Agrega al menos un integrante además de ti')
      return
    }
    setPending(true)
    try {
      const fd = new FormData()
      fd.set('name', name)
      fd.set('seats', seats.join('\n'))
      const res = await createGroup(fd)
      if ('error' in res && res.error) {
        toast.error(res.error)
      } else if ('ok' in res && res.householdId && res.code) {
        setCreated({
          householdId: res.householdId,
          code: res.code,
          groupName: name.trim(),
        })
      }
    } finally {
      setPending(false)
    }
  }

  function copyCode() {
    if (!created) return
    void navigator.clipboard?.writeText(created.code)
    toast.success('Código copiado')
  }

  function shareGroup() {
    if (!created) return
    const text = `Únete a mi grupo "${created.groupName}" en Quanto con el código ${created.code}`
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string }) => Promise<void>
    }
    if (nav.share) {
      nav.share({ title: 'Grupo en Quanto', text }).catch(() => undefined)
    } else {
      void navigator.clipboard?.writeText(text)
      toast.success('Texto copiado para compartir')
    }
  }

  function enterGroup() {
    if (!created) return
    // Navegar primero: al desmontarse, el sheet se cierra solo y no se
    // pelea con el historial (ver useBackToClose).
    router.push(`/cuentas/grupos/${created.householdId}`)
    router.refresh()
  }

  // Paso 2: confirmación grande con el código para compartir.
  if (created) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6 text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="size-8 text-emerald-500" />
        </span>
        <div className="space-y-1">
          <p className="text-2xl font-extrabold tracking-tight">
            ¡Grupo creado!
          </p>
          <p className="text-sm text-(--muted-foreground)">
            {created.groupName} · comparte el código para que entren
          </p>
        </div>
        <button
          type="button"
          onClick={copyCode}
          aria-label="Copiar código del grupo"
          className="mx-auto flex items-center gap-3 rounded-3xl bg-(--muted) px-6 py-4 transition active:scale-95">
          <span className="text-3xl font-extrabold tracking-[0.2em]">
            {created.code}
          </span>
          <Copy className="size-5 text-(--muted-foreground)" />
        </button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={copyCode}
            className="h-12">
            <Copy className="size-4" /> Copiar
          </Button>
          <Button type="button" onClick={shareGroup} className="h-12">
            <Share2 className="size-4" /> Compartir
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={enterGroup}
          className="h-12 w-full text-base">
          Entrar al grupo
        </Button>
      </div>
    )
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
        <Label>Quienes participan</Label>
        <ul className="flex flex-wrap gap-2">
          {seats.map((s, i) =>
            i === 0 ? (
              <li
                key="me"
                className="flex items-center gap-1.5 rounded-full border border-(--primary)/40 bg-(--primary)/10 py-1.5 pr-4 pl-4 text-sm font-semibold">
                {s}
                <span className="text-[11px] font-bold text-(--primary)">
                  · tú
                </span>
              </li>
            ) : (
              <li
                key={`${s.toLowerCase()}-${i}`}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border border-(--border)',
                  'bg-(--muted) py-1.5 pr-2 pl-4 text-sm font-semibold',
                )}>
                {s}
                <button
                  type="button"
                  onClick={() => removeSeat(i)}
                  aria-label={`Quitar a ${s}`}
                  className="flex size-6 items-center justify-center rounded-full bg-(--card) shadow transition active:scale-95">
                  <X className="size-3.5" />
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="group-seat">Agregar integrante</Label>
        <div className="flex gap-2">
          <Input
            id="group-seat"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSeat()
              }
            }}
            placeholder="Juan"
            maxLength={30}
            autoComplete="off"
            className="flex-1"
          />
          <Button
            type="button"
            onClick={addSeat}
            disabled={!draft.trim()}
            aria-label="Añadir integrante"
            className="shrink-0">
            <Plus className="size-4" /> Añadir
          </Button>
        </div>
        <p className="text-xs text-(--muted-foreground)">
          Aunque aún no tengan la app. Podrás agregar más después.
        </p>
      </div>
      <Button
        type="submit"
        disabled={pending || seats.length < 2}
        className="h-12 w-full text-base">
        {pending
          ? 'Creando…'
          : seats.length < 2
            ? 'Agrega integrantes'
            : `Crear grupo (${seats.length})`}
      </Button>
    </form>
  )
}

/** Unirse: pega G-XXXXXX → preview sin montos → ¿quién eres? → claim directo. */
export function GroupJoinSheet() {
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
        router.push(`/cuentas/grupos/${preview.householdId}`)
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
                router.push(`/cuentas/grupos/${preview.householdId}`)
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

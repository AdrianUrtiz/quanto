'use client'

import { useState } from 'react'

import { Check, Copy, HeartHandshake, Link2, Unlink, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  type PairingState,
  acceptPairing,
  cancelPairing,
  getPairingState,
  rejectPairing,
  requestPairing,
  unlinkCouple,
} from '@/lib/couple-actions'
import { cn } from '@/lib/utils'

/** Ajustes > Pareja: código propio, vincular con aceptación y desvincular. */
export function PairingSection({ initial }: { initial: PairingState | null }) {
  const [state, setState] = useState<PairingState | null>(initial)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)

  async function refresh() {
    const res = await getPairingState()
    if ('error' in res) {
      toast.error(res.error)
    } else {
      setState({
        pairCode: res.pairCode,
        partner: res.partner,
        householdId: res.householdId,
        sent: res.sent,
        received: res.received,
      })
    }
  }

  async function run(fn: () => Promise<{ error?: string }>, okMsg?: string) {
    setBusy(true)
    try {
      const res = await fn()
      if ('error' in res && res.error) toast.error(res.error)
      else {
        if (okMsg) toast.success(okMsg)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <section className="w-full rounded-3xl border border-(--border) p-4">
        <p className="text-xs font-semibold text-(--muted-foreground)">
          Pareja
        </p>
        <p className="mt-1 text-sm text-(--muted-foreground)">
          Conéctate para ver tu código de vínculo.
        </p>
      </section>
    )
  }

  return (
    <section className="w-full space-y-3 rounded-3xl border border-(--border) p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted)">
          <HeartHandshake className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Pareja</span>
          <span className="block truncate text-xs text-(--muted-foreground)">
            {state.partner
              ? `Vinculado con ${state.partner.name}`
              : 'Comparte gastos y suscripciones'}
          </span>
        </span>
      </div>

      {/* Mi código: solo sin vínculo (vinculado ya no se necesita). */}
      {!state.partner && (
        <div className="flex items-center gap-2 rounded-2xl bg-(--muted) p-3">
          <span className="flex-1 text-center text-lg font-extrabold tracking-widest">
            {state.pairCode}
          </span>
          <button
            type="button"
            aria-label="Copiar mi código"
            onClick={() => {
              void navigator.clipboard?.writeText(state.pairCode)
              toast.success('Código copiado')
            }}
            className="flex size-9 items-center justify-center rounded-xl bg-(--card) shadow transition active:scale-95">
            <Copy className="size-4" />
          </button>
        </div>
      )}

      {state.partner ? (
        <>
          {!confirmUnlink ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setConfirmUnlink(true)}>
              <Unlink className="size-4" /> Desvincular pareja
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={busy}
                onClick={() =>
                  run(() => unlinkCouple(), 'Pareja desvinculada')
                }>
                Confirmar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmUnlink(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Solicitudes recibidas */}
          {state.received.length > 0 && (
            <div className="space-y-2">
              {state.received.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 p-3">
                  <span className="min-w-0 flex-1 text-sm">
                    <b>{r.fromName}</b> quiere vincularse
                  </span>
                  <button
                    type="button"
                    aria-label={`Aceptar a ${r.fromName}`}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => acceptPairing(r.id),
                        `Vinculado con ${r.fromName}`,
                      )
                    }
                    className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-white transition active:scale-95 disabled:opacity-50">
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Rechazar a ${r.fromName}`}
                    disabled={busy}
                    onClick={() => run(() => rejectPairing(r.id))}
                    className="flex size-9 items-center justify-center rounded-xl bg-(--muted) transition active:scale-95 disabled:opacity-50">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Solicitudes enviadas */}
          {state.sent.length > 0 && (
            <div className="space-y-2">
              {state.sent.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-2xl border border-dashed border-(--border) p-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    Esperando a <b>{s.toName}</b>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => cancelPairing(s.id))}
                    className="text-[11px] font-semibold text-red-500 disabled:opacity-50">
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Pegar código */}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!code.trim()) return
              void run(() => requestPairing(code), 'Solicitud enviada').then(
                () => setCode(''),
              )
            }}>
            <Label htmlFor="pair-code">Pega el código de tu pareja</Label>
            <div className="flex gap-2">
              <Input
                id="pair-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Q-XXXXXX"
                autoComplete="off"
                className={cn('flex-1 uppercase')}
              />
              <Button type="submit" disabled={busy || !code.trim()}>
                <Link2 className="size-4" /> Vincular
              </Button>
            </div>
            <p className="text-xs text-(--muted-foreground)">
              Tu pareja lo acepta desde sus Ajustes. Sin aceptación no se
              comparte nada.
            </p>
          </form>
        </>
      )}
    </section>
  )
}

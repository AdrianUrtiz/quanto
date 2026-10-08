'use client'

import { useState } from 'react'

import { useLiveQuery } from 'dexie-react-hooks'
import {
  ChevronRight,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Moon,
  RefreshCw,
  Shapes,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { toast } from 'sonner'

import { BottomSheet } from '@/components/bottom-sheet'
import { PasswordForm } from '@/components/password-form'
import { type Theme, useTheme } from '@/components/theme-provider'

import { db } from '@/lib/offline/db'
import { OfflineError, syncNow } from '@/lib/offline/sync'
import { useOnlineStatus } from '@/lib/offline/useOnlineStatus'
import { cn } from '@/lib/utils'

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: MonitorSmartphone },
]

export function AjustesClient({ username }: { username?: string }) {
  const { theme, setTheme } = useTheme()
  const [pwOpen, setPwOpen] = useState(false)
  const online = useOnlineStatus()
  const syncMeta = useLiveQuery(() => db.meta.get('sync'), [])
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    try {
      await syncNow()
      toast.success('Datos actualizados')
    } catch (e) {
      if (e instanceof OfflineError && e.code === 'OFFLINE') {
        toast.error('Sin conexión, se usan los datos guardados')
      } else {
        toast.error(e instanceof Error ? e.message : 'No se pudo sincronizar')
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleSignOut() {
    // No dejar datos locales al cerrar sesión (dispositivo compartido).
    try {
      const { clearLocalData } = await import('@/lib/offline/db')
      await clearLocalData()
    } catch {
      // Se cierra sesión de todos modos.
    }
    await signOut({ callbackUrl: '/login' })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pt-4">
      <div>
        <p className="mb-1 text-sm font-medium text-(--muted-foreground)">
          Ajustes
        </p>
        <p className="truncate text-4xl font-extrabold tracking-tight">
          Tu cuenta
        </p>
        {username && (
          <p className="mt-1 truncate text-xs font-medium text-(--muted-foreground) uppercase">
            @{username}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2">
        {/* Tema de la aplicación */}
        <section className="w-full space-y-2 rounded-3xl border border-(--border) p-4">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            Tema de la aplicación
          </p>
          <div className="grid grid-cols-3 gap-2 rounded-full bg-(--muted) p-1">
            {THEMES.map((t) => {
              const Icon = t.icon
              const active = theme === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition',
                    active ? 'bg-(--card) shadow' : 'text-(--muted-foreground)',
                  )}>
                  <Icon className="size-4" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* Datos sin conexión */}
        <section className="w-full space-y-2 rounded-3xl border border-(--border) p-4">
          <p className="text-xs font-semibold text-(--muted-foreground)">
            Datos sin conexión
          </p>
          <div className="flex items-center gap-2 text-sm">
            {online ? (
              <Wifi className="size-4 text-emerald-500" />
            ) : (
              <WifiOff className="size-4 text-amber-500" />
            )}
            <span className="font-medium">
              {online ? 'En línea' : 'Sin conexión'}
            </span>
            <span className="ml-auto text-xs text-(--muted-foreground)">
              {syncMeta?.lastSyncAt
                ? `Actualizado ${new Date(syncMeta.lastSyncAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : 'Aún no descargados'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || !online}
            title={online ? undefined : 'Sin conexión'}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-(--muted) p-3 text-sm font-semibold transition active:scale-[.99] disabled:opacity-50">
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <p className="text-xs text-(--muted-foreground)">
            La app sincroniza sola al abrirla. Sin internet verás la última
            copia guardada (12 meses).
          </p>
        </section>

        {/* Categorías (requiere conexión) */}
        <Link
          href="/categorias"
          aria-disabled={!online}
          onClick={online ? undefined : (e) => e.preventDefault()}
          className={cn(
            'flex items-center gap-3 rounded-3xl border border-(--border) p-4 transition active:scale-[.99]',
            !online && 'pointer-events-none opacity-50',
          )}>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted)">
            <Shapes className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Categorías</span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              Personaliza tu catálogo
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-(--muted-foreground)" />
        </Link>

        {/* Cambiar contraseña (requiere conexión) */}
        <button
          type="button"
          onClick={() => setPwOpen(true)}
          disabled={!online}
          title={online ? undefined : 'Sin conexión'}
          className="flex w-full items-center gap-3 rounded-3xl border border-(--border) p-4 text-left transition active:scale-[.99] disabled:opacity-50">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted)">
            <KeyRound className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Cambiar contraseña
            </span>
            <span className="block truncate text-xs text-(--muted-foreground)">
              Actual, nueva y confirmación
            </span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-(--muted-foreground)" />
        </button>

        <BottomSheet open={pwOpen} onOpenChange={setPwOpen}>
          <PasswordForm onDone={() => setPwOpen(false)} />
        </BottomSheet>

        {/* Cerrar sesión */}
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border border-red-500/30 p-4 text-sm font-semibold text-red-500 transition active:scale-[.99]">
          <LogOut className="size-4" /> Cerrar sesión
        </button>
      </div>
    </div>
  )
}

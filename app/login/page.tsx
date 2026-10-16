'use client'

import { useState } from 'react'

import Image from 'next/image'
import { useRouter } from 'next/navigation'

import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { loginAction } from '@/lib/actions'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Sin conexión a internet. Conéctate para iniciar sesión.')
      return
    }
    setPending(true)
    try {
      const res = await loginAction(new FormData(e.currentTarget))
      if ('error' in res && res.error) {
        setError(res.error)
      } else {
        // Descarga inicial de la copia local (best-effort): si falla,
        // la app entra igual y el AutoSync reintentará con red.
        try {
          const { syncNow } = await import('@/lib/offline/sync')
          await syncNow()
        } catch {
          // Se entra igual; los módulos reintentan al abrirse.
        }
        router.push('/actividad')
        router.refresh()
      }
    } catch {
      setError('No se pudo iniciar sesión, intenta de nuevo')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6">
      <Image
        src="/icons/Web/android-chrome-512x512.png"
        alt="Tándem"
        width={80}
        height={80}
        priority
        className="size-20 rounded-3xl shadow-md"
      />
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Tándem</h1>
      <p className="mt-1 text-sm text-(--muted-foreground)">
        Finanzas personales y en Pareja
      </p>
      <p className="mt-1 text-[11px] text-(--muted-foreground) italic">
        &quot;Lo tuyo, lo mío y lo nuestro&quot;
      </p>

      <Card className="mt-8 w-full">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                name="username"
                type="text"
                placeholder=""
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <PasswordInput
                id="password"
                name="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p className="text-sm font-medium text-red-500">{error}</p>
            )}
            <Button className="w-full" disabled={pending}>
              {pending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

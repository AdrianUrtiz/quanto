"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/lib/actions";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await loginAction(new FormData(e.currentTarget));
    } catch {
      // NEXT_REDIRECT = éxito; si seguimos aquí, fueron credenciales malas
      setError("Revisa tu usuario y contraseña");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-(--primary) text-(--primary-foreground)">
        <Wallet className="size-8" />
      </span>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Quanto</h1>
      <p className="mt-1 text-sm text-(--muted-foreground)">Gastos personales y en pareja</p>

      <Card className="mt-8 w-full">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Usuario</Label>
              <Input id="username" name="username" type="text" placeholder="adrian" autoComplete="username" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" name="password" type="password" placeholder="••••••••" autoComplete="current-password" required />
            </div>
            {error && <p className="text-sm font-medium text-red-500">{error}</p>}
            <Button className="w-full" disabled={pending}>
              {pending ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

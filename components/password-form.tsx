"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import { changePassword } from "@/lib/password-actions";

/** Drawer de Ajustes: actual + nueva + confirmar (8 caracteres y un número). */
export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    const res = await changePassword(new FormData(e.currentTarget));
    setPending(false);
    if ("error" in res && res.error) {
      setMsg(res.error);
      toast.error(res.error);
    } else {
      setMsg(null);
      toast.success("Contraseña actualizada");
      onDone?.();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <p className="text-center text-sm font-bold">Cambiar contraseña</p>

      <div className="space-y-1.5">
        <Label htmlFor="pw-current">Contraseña actual</Label>
        <PasswordInput
          id="pw-current"
          name="current"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          className="h-12 text-base"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-next">Contraseña nueva</Label>
        <PasswordInput
          id="pw-next"
          name="next"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres y un número"
          required
          minLength={8}
          className="h-12 text-base"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">Confirmar contraseña nueva</Label>
        <PasswordInput
          id="pw-confirm"
          name="confirm"
          autoComplete="new-password"
          placeholder="Repite la nueva"
          required
          minLength={8}
          className="h-12 text-base"
        />
      </div>

      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
      <Button type="submit" className="h-12 w-full rounded-2xl text-base" disabled={pending}>
        {pending ? "Guardando…" : "Actualizar contraseña"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCategory, updateCategory } from "@/lib/category-actions";
import { CATEGORY_COLORS, ICONS, ICON_PRESETS } from "@/lib/categories";
import type { CatKind } from "@/lib/categories";
import { cn } from "@/lib/utils";

export type CategoryEditData = {
  id: string;
  name: string;
  iconName: string;
  color: string;
  kind: CatKind;
};

const KINDS: { value: CatKind; label: string }[] = [
  { value: "expense", label: "Gasto" },
  { value: "income", label: "Ingreso" },
  { value: "both", label: "Ambos" },
];

export function CategoryForm({
  initial,
  onDone,
}: {
  initial?: CategoryEditData;
  onDone?: () => void;
}) {
  const editing = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [iconName, setIconName] = useState(
    initial?.iconName ?? ICON_PRESETS[0],
  );
  const [color, setColor] = useState(initial?.color ?? "#fb923c");
  const [kind, setKind] = useState<CatKind>(initial?.kind ?? "expense");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setMsg("Nombre muy corto");
      return;
    }
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    if (editing) fd.set("id", initial!.id);
    fd.set("name", name.trim());
    fd.set("iconName", iconName);
    fd.set("color", color);
    fd.set("kind", kind);
    const res = editing ? await updateCategory(fd) : await createCategory(fd);
    setPending(false);
    if ("error" in res && res.error) setMsg(res.error);
    else onDone?.();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6"
    >
      {editing && <input type="hidden" name="id" value={initial!.id} />}

      {/* Vista previa */}
      <div className="flex items-center gap-3 rounded-3xl border border-(--border) p-4">
        <span
          className="flex size-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${color}22`, color }}
        >
          {(() => {
            const Icon = ICONS[iconName] ?? ICONS.Shapes;
            return <Icon className="size-6" />;
          })()}
        </span>
        <p className="flex-1 truncate text-lg font-bold">
          {name.trim() || "Nombre"}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cat-name">Nombre</Label>
        <Input
          id="cat-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Videojuegos"
          maxLength={30}
          required
          className="h-12 text-base"
        />
      </div>

      <Label>Tipo</Label>
      <div className="grid grid-cols-3 gap-2 rounded-full bg-(--muted) p-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={cn(
              "rounded-full py-2 text-sm font-semibold transition",
              kind === k.value
                ? "bg-(--card) shadow"
                : "text-(--muted-foreground)",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label>Icono</Label>
        <div className="flex flex-wrap gap-1.5">
          {ICON_PRESETS.map((n) => {
            const Icon = ICONS[n] ?? ICONS.Shapes;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setIconName(n)}
                aria-label={n}
                className={cn(
                  "flex size-11 items-center justify-center rounded-2xl border transition active:scale-95",
                  iconName === n
                    ? "border-(--primary) bg-(--primary)/10"
                    : "border-(--border)",
                )}
              >
                <Icon className="size-5" style={{ color }} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="grid grid-cols-8 gap-2">
          {CATEGORY_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => setColor(hex)}
              aria-label={`Color ${hex}`}
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2 ring-1 ring-inset ring-black/10 transition active:scale-95",
                color.toLowerCase() === hex
                  ? "border-(--foreground)"
                  : "border-transparent",
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>

      {msg && (
        <p className="text-center text-sm font-medium text-red-500">{msg}</p>
      )}
      <Button
        type="submit"
        className="h-12 w-full rounded-2xl text-base"
        disabled={pending}
      >
        {pending
          ? "Guardando…"
          : editing
            ? "Guardar cambios"
            : "Crear categoría"}
      </Button>
    </form>
  );
}

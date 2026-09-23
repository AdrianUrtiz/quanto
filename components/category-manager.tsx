"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BottomSheet } from "@/components/bottom-sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CategoryForm, type CategoryEditData } from "@/components/category-form";
import { deleteCategory } from "@/lib/category-actions";
import { ICONS } from "@/lib/categories";
import type { CatalogRow } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export function CategoryManager({ cats }: { cats: CatalogRow[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryEditData | null>(null);
  const [deleting, setDeleting] = useState<CatalogRow | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const mine = (k: string) => cats.filter((c) => (k === "income" ? c.kind === "income" : c.kind !== "income"));
    return [
      { key: "expense", title: "Gastos", rows: mine("expense") },
      { key: "income", title: "Ingresos", rows: mine("income") },
    ];
  }, [cats]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const res = await deleteCategory(deleting.id);
    setBusy(false);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success("Categoría eliminada");
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-5 px-5 pt-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-(--muted-foreground)">Catálogo</p>
          <p className="text-4xl font-extrabold tracking-tight">{cats.length}</p>
        </div>
        <Button size="icon" aria-label="Agregar categoría" className="rounded-full" onClick={() => setAddOpen(true)}>
          <Plus className="size-5" />
        </Button>
      </div>

      {groups.map((g) => (
        <section key={g.key} className="space-y-2">
          <p className="text-xs font-semibold text-(--muted-foreground)">{g.title}</p>
          {g.rows.map((c) => {
            const Icon = ICONS[c.iconName] ?? ICONS.Shapes;
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) p-3.5"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: `${c.color}22`, color: c.color }}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="text-xs text-(--muted-foreground)">
                    {c.isDefault ? "Del sistema" : "Mía"}
                    {c.kind === "both" && " · ambos"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    aria-label={`Editar ${c.name}`}
                    onClick={() =>
                      setEditing({ id: c.id, name: c.name, iconName: c.iconName, color: c.color, kind: c.kind })
                    }
                    className="rounded-full p-2 text-(--muted-foreground) hover:bg-(--muted) hover:text-(--foreground)"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {!c.isDefault && (
                    <button
                      aria-label={`Eliminar ${c.name}`}
                      onClick={() => setDeleting(c)}
                      className="rounded-full p-2 text-(--muted-foreground) hover:bg-(--muted) hover:text-red-500"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <p className="text-center text-[11px] text-(--muted-foreground)">
        Las del sistema se pueden editar (aplica a ambos), pero no eliminar
      </p>

      <BottomSheet open={addOpen} onOpenChange={setAddOpen}>
        <CategoryForm onDone={() => setAddOpen(false)} />
      </BottomSheet>

      <BottomSheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <CategoryForm initial={editing} onDone={() => setEditing(null)} />}
      </BottomSheet>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Solo se puede eliminar si ningún movimiento ni suscripción la usa.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
              {busy ? "Eliminando…" : "Sí, eliminar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CategoryBadge({ mine }: { mine: boolean }) {
  return (
    <Badge variant={mine ? "default" : "secondary"} className={cn(mine && "bg-(--primary)/15")}>
      {mine ? "Mía" : "Sistema"}
    </Badge>
  );
}

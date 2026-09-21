import { ArrowDownLeft, ArrowUpRight, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";

export type TxRow = {
  id: string;
  concept: string;
  category: string;
  amount: number;
  date: string;
  type: string;
  accountName: string;
  creatorName: string;
  installments: number;
  isShared: boolean;
};

const CATEGORY_EMOJI: Record<string, string> = {
  COMIDA: "🍔", TRANSPORTE: "🚗", VIVIENDA: "🏠", SERVICIOS: "💡",
  SALUD: "💊", OCIO: "🎬", COMPRAS: "🛍️", EDUCACION: "📚",
  VIAJES: "✈️", MASCOTAS: "🐾", SUSCRIPCIONES: "🔁", NOMINA: "💼", OTRO: "📦",
};

export function TransactionList({ txs }: { txs: TxRow[] }) {
  if (!txs.length) {
    return <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">Sin movimientos en este periodo.</p>;
  }
  return (
    <ul className="space-y-2">
      {txs.map((t) => {
        const income = t.type === "INCOME";
        const d = new Date(t.date);
        return (
          <li key={t.id} className="flex items-center gap-3 rounded-3xl border border-(--border) bg-(--card) p-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-(--muted) text-xl">
              {CATEGORY_EMOJI[t.category] ?? "📦"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.concept}</p>
              <p className="truncate text-xs text-(--muted-foreground)">
                {d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} · {t.accountName} · {t.creatorName}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {t.installments > 1 && (
                  <Badge variant="warning"><Repeat className="size-3" /> {t.installments} MSI</Badge>
                )}
                {t.isShared && <Badge>Compartido</Badge>}
              </div>
            </div>
            <span className={`flex items-center gap-0.5 text-sm font-extrabold ${income ? "text-emerald-500" : ""}`}>
              {income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
              {income ? "+" : "−"}{formatMoney(t.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

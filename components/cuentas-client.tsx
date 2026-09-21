"use client";

import { useMemo, useState } from "react";
import { HandCoins, Plus } from "lucide-react";
import { AccountCard, type AccountRow } from "@/components/account-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AccountForm } from "@/components/account-form";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

export type DebtLine = {
  concept: string;
  monthly: number;
  installment: number; // parcialidad que cae este mes (1-based)
  installments: number; // total de parcialidades
};

/** Lo que YO le debo a mi pareja este mes, agrupado por cuenta destino. */
export type PartnerDebt = {
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  dueDay?: number;
  creditorName: string;
  total: number;
  lines: DebtLine[];
};

export function CuentasClient({ accounts, meId, debts }: { accounts: AccountRow[]; meId: string; debts: PartnerDebt[] }) {
  const [tab, setTab] = useState("todas");
  const [open, setOpen] = useState(false);

  const mine = useMemo(() => accounts.filter((a) => a.ownerId === meId), [accounts, meId]);

  // Saldo total: suma débitos + disponible de créditos
  const totalOf = (list: AccountRow[]) =>
    list.reduce((a, c) => a + (c.type === "CREDIT" ? (c.creditLimit ?? 0) - c.balance : c.balance), 0);
  const owed = useMemo(() => debts.reduce((a, d) => a + d.total, 0), [debts]);

  const isPartner = tab === "pareja";
  const total = tab === "mias" ? totalOf(mine) : isPartner ? owed : totalOf(mine);
  const shown = tab === "mias" ? mine : accounts;

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-(--muted-foreground)">
            {isPartner ? "Le debes este mes" : "Saldo total"}
          </p>
          <p className="text-4xl font-extrabold tracking-tight">{formatMoney(total)}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="icon" aria-label="Agregar cuenta" className="rounded-full">
              <Plus className="size-5" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nueva cuenta</DialogTitle>
            </DialogHeader>
            <AccountForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="mias">Mis cuentas</TabsTrigger>
          <TabsTrigger value="pareja">Mi pareja</TabsTrigger>
        </TabsList>
        <TabsContent value="todas" className="space-y-2">
          {mine.map((a) => <AccountCard key={a.id} a={a} />)}
          {debts.map((d) => <DebtSummaryRow key={d.accountId} d={d} onOpen={() => setTab("pareja")} />)}
          {mine.length === 0 && debts.length === 0 && <Empty text="Sin cuentas aquí todavía." />}
        </TabsContent>
        <TabsContent value="mias" className="space-y-2">
          {shown.length === 0 && <Empty text="Sin cuentas aquí todavía." />}
          {shown.map((a) => <AccountCard key={a.id} a={a} />)}
        </TabsContent>
        <TabsContent value="pareja" className="space-y-2">
          {debts.length === 0 && <Empty text="No le debes nada a tu pareja este mes. 🎉" />}
          {debts.map((d) => <DebtCard key={d.accountId} d={d} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DebtSummaryRow({ d, onOpen }: { d: PartnerDebt; onOpen: () => void }) {
  const n = d.lines.length;
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-3xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-left transition active:scale-[.99]"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white">
        <HandCoins className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{d.accountName}</span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          Le debes a {d.creditorName} · {n} {n === 1 ? "movimiento" : "movimientos"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">{formatMoney(d.total)}</span>
        <span className="block text-[11px] font-semibold text-amber-500">Ver detalle ›</span>
      </span>
    </button>
  );
}

function DebtCard({ d }: { d: PartnerDebt }) {
  // Crédito → día límite de pago de la tarjeta; débito → antes de fin de mes.
  const due = d.accountType === "CREDIT" && d.dueDay ? `para el día ${d.dueDay}` : "antes de fin de mes";
  return (
    <div className="space-y-1 rounded-3xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
      <p className="flex items-center gap-1.5 text-sm text-(--muted-foreground)">
        <HandCoins className="size-4 text-amber-500" /> Le debes a <b className="text-(--foreground)">{d.creditorName}</b>
      </p>
      <p className="text-2xl font-extrabold tracking-tight">{formatMoney(d.total)}</p>
      <p className="text-xs font-medium text-(--muted-foreground)">
        a {d.accountName} · {due}
      </p>
      <ul className="mt-2 space-y-1 border-t border-(--border) pt-2 text-xs text-(--muted-foreground)">
        {d.lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="truncate">
              · {l.concept}{" "}
              <span className="font-semibold text-(--foreground)">
                ({l.installments > 1 ? `${l.installment}/${l.installments}` : "pago único"})
              </span>
            </span>
            <span className="shrink-0 font-bold text-(--foreground)">{formatMoney(l.monthly)}/mes</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">{text}</p>;
}

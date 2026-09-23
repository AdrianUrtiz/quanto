"use client";

import { useMemo, useState } from "react";
import { HandCoins, Plus } from "lucide-react";
import type { AccountRow } from "@/components/account-card";
import { AccountSwipeRow } from "@/components/account-swipe-row";
import { SubscriptionTab, type SubRow } from "@/components/subscription-tab";
import { SubscriptionSummaryRow } from "@/components/subscription-swipe-row";
import type { DueCharge } from "@/lib/subscriptions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AccountForm } from "@/components/account-form";
import { SubscriptionForm } from "@/components/subscription-form";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

export type DebtLine = {
  concept: string;
  monthly: number;
  installment: number; // parcialidad que cae este mes (1-based)
  installments: number; // total de parcialidades
};

/** Deuda entre pareja este mes, agrupada por cuenta. Si debtorId soy yo, la debo;
 * si no, me la deben. */
export type PartnerDebt = {
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  dueDay?: number;
  debtorId: string;
  debtorName: string;
  creditorName: string;
  total: number;
  lines: DebtLine[];
};

export function CuentasClient({ accounts, meId, debts, owed, subs, dues }: { accounts: AccountRow[]; meId: string; debts: PartnerDebt[]; owed: PartnerDebt[]; subs: SubRow[]; dues: DueCharge[] }) {
  const [tab, setTab] = useState("todas");
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const mine = useMemo(() => accounts.filter((a) => a.ownerId === meId), [accounts, meId]);

  const swipe = (a: AccountRow) => (
    <AccountSwipeRow key={a.id} a={a} open={openRow === a.id} onOpenChange={(o) => setOpenRow(o ? a.id : null)} />
  );

  // Saldo total: suma débitos + disponible de créditos
  const totalOf = (list: AccountRow[]) =>
    list.reduce((a, c) => a + (c.type === "CREDIT" ? (c.creditLimit ?? 0) - c.balance : c.balance), 0);
  const oweTotal = useMemo(() => debts.reduce((a, d) => a + d.total, 0), [debts]);

  const owedTotal = useMemo(() => owed.reduce((a, d) => a + d.total, 0), [owed]);

  const monthly = useMemo(() => subs.filter((s) => s.isActive).reduce((a, s) => a + s.amount, 0), [subs]);

  const accountOpts = useMemo(
    () => mine.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    [mine]
  );

  // Header homologado: texto pequeño → monto grande → botón a la derecha.
  // Botón por tab: todas/pareja ninguno · cuentas: + cuenta · subs: + suscripción.
  const header =
    tab === "mias"
      ? { label: "Saldo total", value: totalOf(mine), action: "account" as const }
      : tab === "subs"
        ? { label: "Comprometido/mes", value: monthly, action: "sub" as const }
        : tab === "pareja"
          ? { label: "Le debes este mes", value: oweTotal, action: null }
          : { label: "Saldo total", value: totalOf(mine), action: null };

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-(--muted-foreground)">{header.label}</p>
          <p className="text-4xl font-extrabold tracking-tight">{formatMoney(header.value)}</p>
        </div>
        {header.action === "account" && (
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
        )}
        {header.action === "sub" && (
          <Dialog open={subOpen} onOpenChange={setSubOpen}>
            <DialogTrigger asChild>
              <Button size="icon" aria-label="Agregar suscripción" className="rounded-full">
                <Plus className="size-5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva suscripción</DialogTitle>
              </DialogHeader>
              <SubscriptionForm accountOptions={accountOpts} onDone={() => setSubOpen(false)} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="mias">Cuentas</TabsTrigger>
          <TabsTrigger value="subs">Suscripciones</TabsTrigger>
          <TabsTrigger value="pareja">Pareja</TabsTrigger>
        </TabsList>
        <TabsContent value="todas" className="space-y-2">
          {mine.map(swipe)}
          {debts.map((d) => <DebtSummaryRow key={`${d.accountId}:${d.debtorId}`} d={d} meId={meId} onOpen={() => setTab("pareja")} />)}
          {owed.map((d) => <DebtSummaryRow key={`${d.accountId}:${d.debtorId}`} d={d} meId={meId} onOpen={() => setTab("pareja")} />)}
          {subs.filter((s) => s.isActive).map((s) => (
            <SubscriptionSummaryRow key={s.id} s={s} onOpen={() => setTab("subs")} />
          ))}
          {mine.length === 0 && debts.length === 0 && owed.length === 0 && subs.filter((s) => s.isActive).length === 0 && (
            <Empty text="Sin cuentas aquí todavía." />
          )}
        </TabsContent>
        <TabsContent value="mias" className="space-y-2">
          {mine.length === 0 && <Empty text="Sin cuentas aquí todavía." />}
          {mine.map(swipe)}
        </TabsContent>
        <TabsContent value="pareja" className="space-y-4">
          {debts.length === 0 && owed.length === 0 && (
            <Empty text="No hay cuentas pendientes con tu pareja este mes. 🎉" />
          )}
          {debts.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Le debes · {formatMoney(oweTotal)}
              </p>
              {debts.map((d) => <DebtCard key={`${d.accountId}:${d.debtorId}`} d={d} meId={meId} />)}
            </section>
          )}
          {owed.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Te deben · {formatMoney(owedTotal)}
              </p>
              {owed.map((d) => <DebtCard key={`${d.accountId}:${d.debtorId}`} d={d} meId={meId} />)}
            </section>
          )}
        </TabsContent>
        <TabsContent value="subs" className="space-y-2">
          <SubscriptionTab subs={subs} dues={dues} accountOptions={accountOpts} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DebtSummaryRow({ d, meId, onOpen }: { d: PartnerDebt; meId: string; onOpen: () => void }) {
  const n = d.lines.length;
  const owe = d.debtorId === meId;
  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-3xl border p-4 text-left transition active:scale-[.99] ${owe ? "debt-owe" : "debt-owed"}`}
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${owe ? "debt-owe-solid" : "debt-owed-solid"}`}>
        <HandCoins className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{d.accountName}</span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          {owe ? `Le debes a ${d.creditorName}` : `${d.debtorName} te debe`} · {n} {n === 1 ? "movimiento" : "movimientos"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">{formatMoney(d.total)}</span>
        <span className={`block text-[11px] font-semibold ${owe ? "debt-owe-text" : "debt-owed-text"}`}>Ver detalle ›</span>
      </span>
    </button>
  );
}

function DebtCard({ d, meId }: { d: PartnerDebt; meId: string }) {
  const owe = d.debtorId === meId;
  // Crédito → día límite de pago de la tarjeta; débito → antes de fin de mes.
  const due = d.accountType === "CREDIT" && d.dueDay ? `para el día ${d.dueDay}` : "antes de fin de mes";
  return (
    <div className={`space-y-1 rounded-3xl border p-4 ${owe ? "debt-owe" : "debt-owed"}`}>
      <p className="flex items-center gap-1.5 text-sm text-(--muted-foreground)">
        <HandCoins className={`size-4 ${owe ? "debt-owe-text" : "debt-owed-text"}`} />{" "}
        {owe ? (
          <>Le debes a <b className="text-(--foreground)">{d.creditorName}</b></>
        ) : (
          <><b className="text-(--foreground)">{d.debtorName}</b> te debe</>
        )}
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

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Check, HandCoins } from "lucide-react";
import type { AccountRow } from "@/components/account-card";
import { AccountSwipeRow } from "@/components/account-swipe-row";
import { SwipeRow } from "@/components/swipe-row";
import { PaymentSheet } from "@/components/payment-sheet";
import { cancelPayment } from "@/lib/payment-actions";
import { SubscriptionTab, type SubPayState, type SubRow } from "@/components/subscription-tab";
import { SubscriptionSummaryRow } from "@/components/subscription-swipe-row";
import type { DueCharge } from "@/lib/subscriptions";
import type { CatalogRow } from "@/lib/catalog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BottomSheet } from "@/components/bottom-sheet";
import { AccountForm } from "@/components/account-form";
import { SubscriptionForm } from "@/components/subscription-form";
import { formatMoney } from "@/lib/utils";

export type DebtLine = {
  concept: string;
  monthly: number;
  installment: number; // parcialidad que cae este mes (1-based)
  installments: number; // total de parcialidades
  shareId: string | null; // null en modo demo (sin pagos)
  month: string; // "YYYY-MM" de la parcialidad
  paid: number; // suma CONFIRMED
  pending: number; // suma PENDING
};

/** Pago pendiente que mi pareja registró y yo debo confirmar (soy el acreedor). */
export type ToConfirmItem = {
  id: string;
  amount: number;
  month: string;
  monthLabel: string;
  concept: string;
  monthly: number;
  shareId: string;
  registeredByName: string;
};

/** Pago que yo registré y espera confirmación de mi pareja. */
export type MyPendingItem = {
  id: string;
  amount: number;
  month: string;
  monthLabel: string;
  concept: string;
  monthly: number;
  shareId: string;
  confirmerName: string;
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

export function CuentasClient({ accounts, meId, debts, owed, subs, dues, cats, toConfirm = [], myPending = [], payStates = [] }: { accounts: AccountRow[]; meId: string; debts: PartnerDebt[]; owed: PartnerDebt[]; subs: SubRow[]; dues: DueCharge[]; cats: CatalogRow[]; toConfirm?: ToConfirmItem[]; myPending?: MyPendingItem[]; payStates?: SubPayState[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("todas");
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [paySheet, setPaySheet] = useState<{ d: PartnerDebt; mode: "receive" | "pay" } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ToConfirmItem | null>(null);

  const refresh = () => router.refresh();

  const mine = useMemo(() => accounts.filter((a) => a.ownerId === meId), [accounts, meId]);

  const swipe = (a: AccountRow) => (
    <AccountSwipeRow
      key={a.id}
      a={a}
      open={openRow === a.id}
      onOpenChange={(o) => setOpenRow(o ? a.id : null)}
      debitOptions={mine.filter((m) => m.type === "DEBIT").map((m) => ({ id: m.id, name: m.name, type: m.type }))}
    />
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
            <BottomSheet open={open} onOpenChange={setOpen}>
              <AccountForm onDone={() => setOpen(false)} />
            </BottomSheet>
        )}
        {header.action === "sub" && (
            <BottomSheet open={subOpen} onOpenChange={setSubOpen}>
              <SubscriptionForm accountOptions={accountOpts} cats={cats} onDone={() => setSubOpen(false)} />
            </BottomSheet>
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
          {debts.length === 0 && owed.length === 0 && toConfirm.length === 0 && myPending.length === 0 && (
            <Empty text="No hay cuentas pendientes con tu pareja este mes. 🎉" />
          )}
          {toConfirm.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Por confirmar · {formatMoney(toConfirm.reduce((a, p) => a + p.amount, 0))}
              </p>
              {toConfirm.map((p) => (
                <ToConfirmRow key={p.id} p={p} onOpen={() => setConfirmTarget(p)} />
              ))}
            </section>
          )}
          {myPending.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">En espera de confirmación</p>
              {myPending.map((p) => (
                <MyPendingRow key={p.id} p={p} onDone={refresh} />
              ))}
            </section>
          )}
          {debts.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Le debes · {formatMoney(oweTotal)}
              </p>
              <p className="-mt-1 text-[11px] text-(--muted-foreground)">Desliza a la derecha para registrar tu pago ›</p>
              {debts.map((d) => (
                <DebtSwipeRow
                  key={`${d.accountId}:${d.debtorId}`}
                  d={d}
                  meId={meId}
                  open={openRow === `${d.accountId}:${d.debtorId}`}
                  onOpenChange={(o) => setOpenRow(o ? `${d.accountId}:${d.debtorId}` : null)}
                  onPay={(mode) => setPaySheet({ d, mode })}
                />
              ))}
            </section>
          )}
          {owed.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Te deben · {formatMoney(owedTotal)}
              </p>
              <p className="-mt-1 text-[11px] text-(--muted-foreground)">Desliza a la derecha para registrar el cobro ›</p>
              {owed.map((d) => (
                <DebtSwipeRow
                  key={`${d.accountId}:${d.debtorId}`}
                  d={d}
                  meId={meId}
                  open={openRow === `${d.accountId}:${d.debtorId}`}
                  onOpenChange={(o) => setOpenRow(o ? `${d.accountId}:${d.debtorId}` : null)}
                  onPay={(mode) => setPaySheet({ d, mode })}
                />
              ))}
            </section>
          )}
        </TabsContent>
        <TabsContent value="subs" className="space-y-2">
          <SubscriptionTab subs={subs} dues={dues} accountOptions={accountOpts} cats={cats} payStates={payStates} accounts={accounts} />
        </TabsContent>
      </Tabs>

      <BottomSheet open={paySheet != null} onOpenChange={(o) => !o && setPaySheet(null)}>
        {paySheet && (
          <PaymentSheet
            key={`${paySheet.d.accountId}:${paySheet.d.debtorId}:${paySheet.mode}`}
            mode={paySheet.mode}
            lines={paySheet.d.lines.flatMap((l) =>
              l.shareId ? [{ shareId: l.shareId, concept: l.concept, installment: l.installment, installments: l.installments, month: l.month, monthly: l.monthly, paid: l.paid, pending: l.pending }] : []
            )}
            accountOptions={accountOpts}
            onDone={() => {
              setPaySheet(null);
              refresh();
            }}
          />
        )}
      </BottomSheet>
      <BottomSheet open={confirmTarget != null} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        {confirmTarget && (
          <PaymentSheet
            key={confirmTarget.id}
            mode="confirm"
            payment={confirmTarget}
            accountOptions={accountOpts}
            onDone={() => {
              setConfirmTarget(null);
              refresh();
            }}
          />
        )}
      </BottomSheet>
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
      <ul className="mt-2 space-y-1.5 border-t border-(--border) pt-2 text-xs text-(--muted-foreground)">
        {d.lines.map((l, i) => {
          const rest = Math.max(0, l.monthly - l.paid);
          const settled = l.shareId != null && rest <= 0.005;
          return (
            <li key={i}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">
                  · {l.concept}{" "}
                  <span className="font-semibold text-(--foreground)">
                    ({l.installments > 1 ? `${l.installment}/${l.installments}` : "pago único"})
                  </span>
                </span>
                <span className="shrink-0 font-bold text-(--foreground)">{formatMoney(l.monthly)}/mes</span>
              </span>
              {l.shareId != null &&
                (settled ? (
                  <span className="mt-0.5 flex items-center gap-1 font-semibold text-emerald-500">
                    <Check className="size-3" /> Liquidado
                  </span>
                ) : (
                  (l.paid > 0 || l.pending > 0) && (
                    <span className="mt-0.5 block">
                      {l.paid > 0 && <>Abonado {formatMoney(l.paid)} · </>}
                      {l.pending > 0 && <>Por confirmar {formatMoney(l.pending)} · </>}
                      Restan {formatMoney(rest)}
                    </span>
                  )
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DebtSwipeRow({
  d, meId, open, onOpenChange, onPay,
}: {
  d: PartnerDebt;
  meId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPay: (mode: "receive" | "pay") => void;
}) {
  const owe = d.debtorId === meId; // yo debo → "Le pagué"; me deben → "Me pagó"
  const settled =
    d.lines.length > 0 &&
    d.lines.every((l) => l.shareId == null || l.monthly - l.paid <= 0.005);
  const card = <DebtCard d={d} meId={meId} />;
  if (!d.lines.some((l) => l.shareId)) return card; // demo: sin pagos
  return (
    <SwipeRow
      open={open}
      onOpenChange={onOpenChange}
      leftActionsWidth={132}
      disabled={settled}
      leftActions={
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onPay(owe ? "pay" : "receive");
          }}
          className={
            owe
              ? "flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-amber-500 text-xs font-semibold text-white shadow-xs transition-all hover:bg-amber-600 active:scale-95"
              : "flex h-full flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 text-xs font-semibold text-white shadow-xs transition-all hover:bg-emerald-600 active:scale-95"
          }
        >
          {owe ? <ArrowUpRight className="size-4" /> : <HandCoins className="size-4" />}
          <span>{owe ? "Le pagué" : "Me pagó"}</span>
        </button>
      }
    >
      {card}
    </SwipeRow>
  );
}

function ToConfirmRow({ p, onOpen }: { p: ToConfirmItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-3xl border border-emerald-500/40 p-4 text-left transition active:scale-[.99]"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15">
        <HandCoins className="size-5 text-emerald-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{p.concept} · {p.monthLabel}</span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          {p.registeredByName} dice que te pagó
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">{formatMoney(p.amount)}</span>
        <span className="block text-[11px] font-semibold text-emerald-500">Revisar ›</span>
      </span>
    </button>
  );
}

function MyPendingRow({ p, onDone }: { p: MyPendingItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function cancel() {
    setBusy(true);
    const res = await cancelPayment(p.id);
    setBusy(false);
    if ("error" in res && res.error) toast.error(res.error);
    else {
      toast.success("Registro cancelado");
      onDone();
    }
  }
  return (
    <div className="flex w-full items-center gap-3 rounded-3xl border border-dashed border-(--border) p-4">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{p.concept} · {p.monthLabel}</span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          Esperando a {p.confirmerName}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">{formatMoney(p.amount)}</span>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="block text-[11px] font-semibold text-red-500 disabled:opacity-50"
        >
          {busy ? "Cancelando…" : "Cancelar"}
        </button>
      </span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">{text}</p>;
}


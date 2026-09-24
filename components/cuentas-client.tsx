"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Check, HandCoins } from "lucide-react";
import type { AccountRow } from "@/components/account-card";
import { AccountSwipeRow } from "@/components/account-swipe-row";
import { SwipeRow } from "@/components/swipe-row";
import { PaymentSheet } from "@/components/payment-sheet";
import { cancelPayment, confirmPaymentSource } from "@/lib/payment-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterOptions, FilterPill } from "@/components/filter-dialog";
import { SubscriptionTab, type SubRow } from "@/components/subscription-tab";
import { SubscriptionSummaryRow } from "@/components/subscription-swipe-row";
import type { DueCharge } from "@/lib/subscriptions";
import type { CatalogRow } from "@/lib/catalog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BottomSheet } from "@/components/bottom-sheet";
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

/** Cobro que el acreedor dice recibido y espera que yo indique de qué cuenta salió. */
export type SourceConfirmItem = {
  id: string;
  amount: number;
  month: string;
  monthLabel: string;
  concept: string;
  creditorName: string;
};

/** Deuda entre pareja este mes, agrupada por cuenta. Si debtorId soy yo, la debo;
 * si no, me la deben. `total` = mensualidades originales; `remaining` = por pagar. */
export type PartnerDebt = {
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  dueDay?: number;
  debtorId: string;
  debtorName: string;
  creditorName: string;
  total: number;
  remaining: number;
  lines: DebtLine[];
};

export function CuentasClient({ accounts, meId, debts, owed, subs, dues, cats, toConfirm = [], myPending = [], toConfirmSource = [] }: { accounts: AccountRow[]; meId: string; debts: PartnerDebt[]; owed: PartnerDebt[]; subs: SubRow[]; dues: DueCharge[]; cats: CatalogRow[]; toConfirm?: ToConfirmItem[]; myPending?: MyPendingItem[]; toConfirmSource?: SourceConfirmItem[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("todas");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [paySheet, setPaySheet] = useState<{ d: PartnerDebt; mode: "receive" | "pay" } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ToConfirmItem | null>(null);
  const [sourceTarget, setSourceTarget] = useState<SourceConfirmItem | null>(null);

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
  const oweTotal = useMemo(() => debts.reduce((a, d) => a + d.remaining, 0), [debts]);

  const owedTotal = useMemo(() => owed.reduce((a, d) => a + d.remaining, 0), [owed]);

  const monthly = useMemo(() => subs.filter((s) => s.isActive).reduce((a, s) => a + s.amount, 0), [subs]);

  const accountOpts = useMemo(
    () => mine.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    [mine]
  );

  // Filtros de la tab Cuentas: orden + tipo/estado.
  const [accSort, setAccSort] = useState("default");
  const [accType, setAccType] = useState("all");
  const [accSheet, setAccSheet] = useState<null | "sort" | "type">(null);
  const [allSection, setAllSection] = useState("all");
  const [allSort, setAllSort] = useState("default");
  const [allSheet, setAllSheet] = useState<null | "section" | "sort">(null);

  // Monto representativo: saldo en débito, disponible en crédito.
  const effValue = (a: AccountRow) =>
    a.type === "CREDIT" ? (a.creditLimit ?? 0) - a.balance : a.balance;

  function daysUntilDue(dueDay: number, now = new Date()): number {
    const dimThis = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayThis = Math.min(dueDay, dimThis);
    if (dayThis >= now.getDate()) return dayThis - now.getDate();
    const dimNext = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate();
    return dimThis - now.getDate() + Math.min(dueDay, dimNext);
  }

  const filteredMine = useMemo(() => {
    let list = mine;
    if (accType === "debit") list = list.filter((a) => a.type === "DEBIT");
    else if (accType === "credit") list = list.filter((a) => a.type === "CREDIT");
    else if (accType === "debt") list = list.filter((a) => a.type === "CREDIT" && a.balance > 0.005);
    else if (accType === "due") list = list.filter((a) => a.type === "CREDIT" && a.dueDay != null && daysUntilDue(a.dueDay) <= 7);
    const sorted = [...list];
    if (accSort === "high") sorted.sort((a, b) => effValue(b) - effValue(a));
    else if (accSort === "low") sorted.sort((a, b) => effValue(a) - effValue(b));
    else if (accSort === "az") sorted.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return sorted;
  }, [mine, accSort, accType]);

  const typeCounts = useMemo(() => {
    const debt = mine.filter((a) => a.type === "CREDIT" && a.balance > 0.005).length;
    const due = mine.filter((a) => a.type === "CREDIT" && a.dueDay != null && daysUntilDue(a.dueDay) <= 7).length;
    return {
      all: mine.length,
      debit: mine.filter((a) => a.type === "DEBIT").length,
      credit: mine.filter((a) => a.type === "CREDIT").length,
      debt,
      due,
    };
  }, [mine]);

  const SORT_OPTS = [
    { value: "default", label: "Predeterminado" },
    { value: "high", label: "Mayor monto" },
    { value: "low", label: "Menor monto" },
    { value: "az", label: "Nombre A–Z" },
  ];
  const SECTION_OPTS = [
    { value: "all", label: "Todo" },
    { value: "accounts", label: "Cuentas" },
    { value: "debts", label: "Pareja" },
    { value: "subs", label: "Suscripciones" },
  ];

  function sortAccounts(list: AccountRow[]) {
    const sorted = [...list];
    if (allSort === "high") sorted.sort((a, b) => effValue(b) - effValue(a));
    else if (allSort === "low") sorted.sort((a, b) => effValue(a) - effValue(b));
    return sorted;
  }

  const allMine = sortAccounts(mine);
  const allDebts = useMemo(() => {
    const sorted = [...debts];
    if (allSort === "high") sorted.sort((a, b) => b.remaining - a.remaining);
    else if (allSort === "low") sorted.sort((a, b) => a.remaining - b.remaining);
    return sorted;
  }, [debts, allSort]);
  const allOwed = useMemo(() => {
    const sorted = [...owed];
    if (allSort === "high") sorted.sort((a, b) => b.remaining - a.remaining);
    else if (allSort === "low") sorted.sort((a, b) => a.remaining - b.remaining);
    return sorted;
  }, [owed, allSort]);
  const allSubs = useMemo(() => {
    const list = subs.filter((s) => s.isActive);
    const sorted = [...list];
    if (allSort === "high") sorted.sort((a, b) => b.amount - a.amount);
    else if (allSort === "low") sorted.sort((a, b) => a.amount - b.amount);
    return sorted;
  }, [subs, allSort]);

  const showAccounts = allSection === "all" || allSection === "accounts";
  const showDebts = allSection === "all" || allSection === "debts";
  const showSubs = allSection === "all" || allSection === "subs";
  const allEmpty =
    (!showAccounts || allMine.length === 0) &&
    (!showDebts || (allDebts.length === 0 && allOwed.length === 0)) &&
    (!showSubs || allSubs.length === 0);
  const TYPE_OPTS = [
    { value: "all", label: "Todas" },
    { value: "debit", label: "Débito" },
    { value: "credit", label: "Crédito" },
    { value: "debt", label: "Con deuda" },
    { value: "due", label: "Vence pronto" },
  ];

  // Header homologado: texto pequeño → monto grande (sin botones; la creación
  // vive en el speed-dial del FAB). En Cuentas el total responde al filtro.
  const header =
    tab === "mias"
      ? { label: "Saldo total", value: totalOf(filteredMine) }
      : tab === "subs"
        ? { label: "Comprometido/mes", value: monthly }
        : tab === "pareja"
          ? { label: "Le debes este mes", value: oweTotal }
          : { label: "Saldo total", value: totalOf(mine) };

  return (
    <div className="space-y-4 px-5 pt-4">
      <div>
        <p className="text-xs font-medium text-(--muted-foreground)">{header.label}</p>
        <p className="text-4xl font-extrabold tracking-tight">{formatMoney(header.value)}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="mias">Cuentas</TabsTrigger>
          <TabsTrigger value="subs">Suscripciones</TabsTrigger>
          <TabsTrigger value="pareja">Pareja</TabsTrigger>
        </TabsList>
        <TabsContent value="todas" className="space-y-2">
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            <FilterPill
              label={SECTION_OPTS.find((o) => o.value === allSection)!.label}
              active={allSection !== "all"}
              onClick={() => setAllSheet("section")}
            />
            <FilterPill
              label={SORT_OPTS.find((o) => o.value === allSort)!.label}
              active={allSort !== "default"}
              onClick={() => setAllSheet("sort")}
            />
          </div>
          {showAccounts && allMine.map(swipe)}
          {showDebts && allDebts.map((d) => <DebtSummaryRow key={`${d.accountId}:${d.debtorId}`} d={d} meId={meId} onOpen={() => setTab("pareja")} />)}
          {showDebts && allOwed.map((d) => <DebtSummaryRow key={`${d.accountId}:${d.debtorId}`} d={d} meId={meId} onOpen={() => setTab("pareja")} />)}
          {showSubs && allSubs.map((s) => (
            <SubscriptionSummaryRow key={s.id} s={s} onOpen={() => setTab("subs")} />
          ))}
          {allEmpty && (
            <Empty
              text={
                mine.length === 0 && debts.length === 0 && owed.length === 0 && subs.filter((s) => s.isActive).length === 0
                  ? "Sin cuentas aquí todavía."
                  : "Sin resultados para ese filtro."
              }
            />
          )}
        </TabsContent>
        <TabsContent value="mias" className="space-y-2">
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            <FilterPill
              label={SORT_OPTS.find((o) => o.value === accSort)!.label}
              active={accSort !== "default"}
              onClick={() => setAccSheet("sort")}
            />
            <FilterPill
              label={TYPE_OPTS.find((o) => o.value === accType)!.label}
              active={accType !== "all"}
              onClick={() => setAccSheet("type")}
            />
          </div>
          {filteredMine.length === 0 && (
            <Empty text={mine.length === 0 ? "Sin cuentas aquí todavía." : "Sin resultados para ese filtro."} />
          )}
          {filteredMine.map(swipe)}
        </TabsContent>
        <TabsContent value="pareja" className="space-y-4">
          {debts.length === 0 && owed.length === 0 && toConfirm.length === 0 && myPending.length === 0 && toConfirmSource.length === 0 && (
            <Empty text="No hay cuentas pendientes con tu pareja este mes. 🎉" />
          )}
          {toConfirmSource.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-(--muted-foreground)">
                Confirma de qué cuenta salió · {formatMoney(toConfirmSource.reduce((a, p) => a + p.amount, 0))}
              </p>
              {toConfirmSource.map((p) => (
                <SourceConfirmRow key={p.id} p={p} onOpen={() => setSourceTarget(p)} />
              ))}
            </section>
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
          <SubscriptionTab subs={subs} dues={dues} accountOptions={accountOpts} cats={cats} />
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
      <BottomSheet open={sourceTarget != null} onOpenChange={(o) => !o && setSourceTarget(null)}>
        {sourceTarget && (
          <SourceConfirmSheet
            key={sourceTarget.id}
            p={sourceTarget}
            accountOptions={accountOpts}
            onDone={() => {
              setSourceTarget(null);
              refresh();
            }}
          />
        )}
      </BottomSheet>

      <Dialog open={accSheet !== null} onOpenChange={(o) => !o && setAccSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{accSheet === "sort" ? "Ordenar cuentas" : "Filtrar cuentas"}</DialogTitle>
          </DialogHeader>
          {accSheet === "sort" ? (
            <FilterOptions
              items={SORT_OPTS}
              value={accSort}
              onPick={(v) => {
                setAccSort(v);
                setAccSheet(null);
              }}
            />
          ) : (
            <FilterOptions
              items={TYPE_OPTS.map((o) => ({
                ...o,
                meta: `${typeCounts[o.value as keyof typeof typeCounts]} · ${
                  typeCounts[o.value as keyof typeof typeCounts] === 1 ? "cuenta" : "cuentas"
                }`,
              }))}
              value={accType}
              onPick={(v) => {
                setAccType(v);
                setAccSheet(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={allSheet !== null} onOpenChange={(o) => !o && setAllSheet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{allSheet === "sort" ? "Ordenar todo" : "Secciones visibles"}</DialogTitle>
          </DialogHeader>
          {allSheet === "sort" ? (
            <FilterOptions
              items={SORT_OPTS.filter((o) => o.value !== "az")}
              value={allSort}
              onPick={(v) => {
                setAllSort(v);
                setAllSheet(null);
              }}
            />
          ) : (
            <FilterOptions
              items={SECTION_OPTS}
              value={allSection}
              onPick={(v) => {
                setAllSection(v);
                setAllSheet(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
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
        <span className="block text-base font-extrabold">{formatMoney(d.remaining)}</span>
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
      <p className="text-2xl font-extrabold tracking-tight">{formatMoney(d.remaining)}</p>
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
                      {l.paid > 0 && <>Abonado {formatMoney(l.paid)}</>}
                      {l.pending > 0 && <> · Por confirmar {formatMoney(l.pending)}</>}
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

function SourceConfirmRow({ p, onOpen }: { p: SourceConfirmItem; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-3xl border border-sky-500/40 p-4 text-left transition active:scale-[.99]"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15">
        <ArrowUpRight className="size-5 text-sky-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{p.concept} · {p.monthLabel}</span>
        <span className="block truncate text-xs text-(--muted-foreground)">
          {p.creditorName} dice que le pagaste · ¿de qué cuenta salió?
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-extrabold">{formatMoney(p.amount)}</span>
        <span className="block text-[11px] font-semibold text-sky-500">Indicar ›</span>
      </span>
    </button>
  );
}

function SourceConfirmSheet({ p, accountOptions, onDone }: { p: SourceConfirmItem; accountOptions: { id: string; name: string }[]; onDone: () => void }) {
  const [accountId, setAccountId] = useState(accountOptions[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!accountId) {
      setMsg("Elige de qué cuenta salió");
      return;
    }
    setMsg(null);
    setPending(true);
    const fd = new FormData();
    fd.set("paymentId", p.id);
    fd.set("accountId", accountId);
    const res = await confirmPaymentSource(fd);
    setPending(false);
    if ("error" in res && res.error) {
      setMsg(res.error);
      toast.error(res.error);
    } else {
      toast.success("Origen confirmado");
      onDone();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
      <div className="space-y-1 text-center">
        <p className="text-sm font-bold">{p.concept} · {p.monthLabel}</p>
        <p className="text-xs text-(--muted-foreground)">
          {p.creditorName} registró que le pagaste <b className="text-(--foreground)">{formatMoney(p.amount)}</b>.
          Elige de qué cuenta salió para reflejar tu egreso.
        </p>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {accountOptions.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setAccountId(a.id)}
              className={`flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left transition hover:bg-(--muted) ${accountId === a.id ? "bg-(--muted)" : ""}`}
            >
              <span className="flex-1 text-sm font-semibold">{a.name}</span>
              {accountId === a.id && <Check className="size-4 text-(--primary)" />}
            </button>
          </li>
        ))}
      </ul>
      {msg && <p className="text-center text-sm font-medium text-red-500">{msg}</p>}
      <Button type="button" className="h-12 w-full rounded-2xl text-base" disabled={pending || !accountId} onClick={confirm}>
        {pending ? "Guardando…" : "Confirmar origen"}
      </Button>
    </div>
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


"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AccountCard, type AccountRow } from "@/components/account-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AccountForm } from "@/components/account-form";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";

export function CuentasClient({ accounts, me }: { accounts: AccountRow[]; me: string }) {
  const [tab, setTab] = useState("todas");
  const [open, setOpen] = useState(false);

  const mine = useMemo(() => accounts.filter((a) => a.owner === me), [accounts, me]);
  const partner = useMemo(() => accounts.filter((a) => a.owner !== me), [accounts, me]);

  // Saldo total: suma débitos + disponible de créditos
  const totalOf = (list: AccountRow[]) =>
    list.reduce((a, c) => a + (c.type === "CREDIT" ? (c.creditLimit ?? 0) - c.balance : c.balance), 0);
  const total = totalOf(tab === "mias" ? mine : tab === "pareja" ? partner : accounts);

  const shown = tab === "mias" ? mine : tab === "pareja" ? partner : accounts;

  return (
    <div className="space-y-4 px-5 pt-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-(--muted-foreground)">Saldo total</p>
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
          {shown.map((a) => <AccountCard key={a.id} a={a} />)}
        </TabsContent>
        <TabsContent value="mias" className="space-y-2">
          {shown.length === 0 && <Empty />}
          {shown.map((a) => <AccountCard key={a.id} a={a} />)}
        </TabsContent>
        <TabsContent value="pareja" className="space-y-2">
          {shown.length === 0 && <Empty />}
          {shown.map((a) => <AccountCard key={a.id} a={a} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty() {
  return <p className="rounded-3xl border border-dashed border-(--border) p-8 text-center text-sm text-(--muted-foreground)">Sin cuentas aquí todavía.</p>;
}

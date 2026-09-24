// Saldo calculado — única fuente de verdad para mostrar saldos.
//
// Antes el saldo se guardaba en `Account.balance` y se movía a mano con
// `increment/decrement` en cada acción. Eso derivaba ante fallos a medias,
// dobles clics o flujos que olvidaban revertir (cancel/reject, borrados en
// cascada). Ahora el saldo se deriva de los movimientos:
//
// - DEBIT:  balance = initialBalance + INCOME - EXPENSE - TRANSFER_out + TRANSFER_in
// - CREDIT: balance = deuda = EXPENSE - INCOME + TRANSFER_out - TRANSFER_in
//
// `TRANSFER_out` = filas con `accountId = cuenta`.
// `TRANSFER_in`  = filas con `transferToAccountId = cuenta` (el destino no
// tiene fila propia, solo esta referencia).
//
// Los movimientos de Pareja (ingreso del acreedor / egreso del deudor) ya son
// `Transaction` normales, así que entran solos en la suma.

import { prisma } from "@/lib/prisma";

type AccountKind = "DEBIT" | "CREDIT";

/** Efecto con signo de un movimiento origen sobre su cuenta. */
export function originSign(txType: string, accType: AccountKind): 1 | -1 {
  if (txType === "EXPENSE") return accType === "CREDIT" ? 1 : -1;
  if (txType === "INCOME") return accType === "DEBIT" ? 1 : -1;
  // TRANSFER origen: sale de la cuenta.
  return accType === "DEBIT" ? -1 : 1;
}

/** Efecto con signo de un traspaso sobre la cuenta destino. */
export function destSign(destType: AccountKind): 1 | -1 {
  // Destino débito suma saldo; destino crédito reduce deuda (libera línea).
  return destType === "DEBIT" ? 1 : -1;
}

/**
 * Saldos calculados de todas las cuentas activas de un usuario.
 * Dos `groupBy` (orígenes + destinos de traspaso) + `initialBalance`.
 */
export async function getAccountBalances(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!process.env.DATABASE_URL || !userId) return out;

  const accounts = await prisma.account.findMany({
    where: { userId, isActive: true },
    select: { id: true, type: true, initialBalance: true },
  });
  if (!accounts.length) return out;

  const ids = accounts.map((a) => a.id);
  const kindById = new Map(accounts.map((a) => [a.id, a.type as AccountKind]));
  for (const a of accounts) {
    out.set(a.id, a.type === "DEBIT" ? Number(a.initialBalance ?? 0) : 0);
  }

  const [origins, dests] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["accountId", "type"],
      where: { accountId: { in: ids } },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["transferToAccountId"],
      where: { type: "TRANSFER", transferToAccountId: { in: ids } },
      _sum: { amount: true },
    }),
  ]);

  for (const r of origins) {
    const kind = kindById.get(r.accountId);
    if (!kind) continue;
    const amt = Number(r._sum.amount ?? 0);
    out.set(r.accountId, (out.get(r.accountId) ?? 0) + originSign(r.type, kind) * amt);
  }
  for (const r of dests) {
    const destId = r.transferToAccountId;
    if (!destId) continue;
    const kind = kindById.get(destId);
    if (!kind) continue;
    const amt = Number(r._sum.amount ?? 0);
    out.set(destId, (out.get(destId) ?? 0) + destSign(kind) * amt);
  }

  // Redondeo a centavos para evitar deriva de flotantes.
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100);
  return out;
}

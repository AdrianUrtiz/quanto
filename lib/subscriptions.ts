// Suscripciones como checklist mensual: el cargo es un hecho indivisible en la
// tarjeta del dueño; lo único que se rastrea es quién cubrió su parte.
// Sin TransactionShare ni DebtPayment para suscripciones.

export type SubInfo = {
  id: string;
  name: string;
  amount: number;
  category: string;
  accountId: string;
  accountName: string;
  accountType: "DEBIT" | "CREDIT";
  chargeDay: number;
  isShared: boolean;
  sharePct: number;
  shareAmount: number | null;
  isActive: boolean;
  startMonth: string; // "YYYY-MM"
  ownerId: string;
  ownerName: string;
  isMine: boolean;
  /** Nombre del otro miembro (para "¿Te pagó X?"). En las suyas = la dueña. */
  partnerName: string | null;
};

export type ChargeRow = {
  subscriptionId: string;
  month: string;
  transactionId: string | null;
  ownerPaid: boolean;
  partnerPaid: boolean;
  ownerPaidByName: string | null;
  partnerPaidByName: string | null;
};

export type DueCharge = SubInfo & {
  monthKey: string;
  monthLabel: string;
  dateISO: string; // fecha del cargo (día ajustado al mes)
  overdue: boolean;
  confirmed: boolean;
  ownerPaid: boolean;
  partnerPaid: boolean;
  ownerPaidByName: string | null;
  partnerPaidByName: string | null;
  /** Parte de la pareja ese mes (referencia para el check). */
  monthlyShare: number | null;
};

export type MonthMark = {
  monthKey: string;
  short: string; // "sep"
  confirmed: boolean;
  partnerPaid: boolean;
  isShared: boolean;
};

export function monthKeyOf(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

export function monthLabelOf(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

export function monthShortOf(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString("es-MX", { month: "short" })
    .replace(".", "");
}

/** Fecha del cargo: chargeDay ajustado al último día si el mes es más corto. */
export function chargeDate(monthKey: string, chargeDay: number): Date {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(Math.max(1, chargeDay), last), 12, 0, 0);
}

function eachMonth(fromKey: string, toKey: string): string[] {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);
  const out: string[] = [];
  const d = new Date(fy, fm - 1, 1);
  const end = new Date(ty, tm - 1, 1);
  while (d <= end) {
    out.push(monthKeyOf(d.getFullYear(), d.getMonth()));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/**
 * Pendientes de una suscripción: meses sin fila de cargo (por confirmar) +
 * meses confirmados de compartidas sin el check de la pareja.
 */
export function computeDues(
  subs: SubInfo[],
  charges: Map<string, ChargeRow>, // `${subId}:${month}`
  now = new Date(),
  lookbackMonths = 6,
): DueCharge[] {
  const dues: DueCharge[] = [];
  const curKey = monthKeyOf(now.getFullYear(), now.getMonth());
  const minD = new Date(now.getFullYear(), now.getMonth() - lookbackMonths + 1, 1);
  const minKey = monthKeyOf(minD.getFullYear(), minD.getMonth());

  for (const s of subs) {
    if (!s.isActive) continue;
    const from = s.startMonth > minKey ? s.startMonth : minKey;
    const monthlyShare = s.isShared
      ? (s.shareAmount ?? (s.amount * s.sharePct) / 100)
      : null;
    for (const key of eachMonth(from, curKey)) {
      const ch = charges.get(`${s.id}:${key}`);
      if (!ch) {
        const date = chargeDate(key, s.chargeDay);
        dues.push({
          ...s,
          monthKey: key,
          monthLabel: monthLabelOf(key),
          dateISO: date.toISOString(),
          overdue: key < curKey,
          confirmed: false,
          ownerPaid: false,
          partnerPaid: false,
          ownerPaidByName: null,
          partnerPaidByName: null,
          monthlyShare,
        });
      } else if (s.isShared && !ch.partnerPaid) {
        const date = chargeDate(key, s.chargeDay);
        dues.push({
          ...s,
          monthKey: key,
          monthLabel: monthLabelOf(key),
          dateISO: date.toISOString(),
          overdue: key < curKey,
          confirmed: true,
          ownerPaid: ch.ownerPaid,
          partnerPaid: false,
          ownerPaidByName: ch.ownerPaidByName,
          partnerPaidByName: null,
          monthlyShare,
        });
      }
    }
  }

  return dues.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
}

/** Historial reciente (tira de meses) para la fila de cada suscripción. */
export function monthHistory(
  sub: SubInfo,
  charges: Map<string, ChargeRow>,
  now = new Date(),
  count = 6,
): MonthMark[] {
  const out: MonthMark[] = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = monthKeyOf(dt.getFullYear(), dt.getMonth());
    const ch = charges.get(`${sub.id}:${key}`);
    out.push({
      monthKey: key,
      short: monthShortOf(key),
      confirmed: Boolean(ch),
      partnerPaid: ch?.partnerPaid ?? false,
      isShared: sub.isShared,
    });
  }
  return out;
}

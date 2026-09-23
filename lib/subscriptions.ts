// Cálculo de cargos pendientes de suscripciones (puro, sin DB).
// Un mes está pendiente si la suscripción está activa y no existe un
// Transaction vinculado a (subscriptionId, mes).

export type SubInfo = {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  accountName: string;
  chargeDay: number;
  isShared: boolean;
  sharePct: number;
  shareAmount: number | null;
  isActive: boolean;
  startMonth: string; // "YYYY-MM"
  creditorName?: string;
};

export type DueCharge = SubInfo & {
  monthKey: string; // "YYYY-MM" del cargo pendiente
  monthLabel: string; // "septiembre 2026"
  dateISO: string; // fecha del cargo (día ajustado al mes)
  overdue: boolean;
  monthlyShare: number | null; // lo que aporta el deudor por este cargo
};

export function monthKeyOf(y: number, m0: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}`;
}

export function monthLabelOf(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

/** Fecha del cargo: chargeDay ajustado al último día si el mes es más corto. */
export function chargeDate(monthKey: string, chargeDay: number): Date {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(Math.max(1, chargeDay), last), 12, 0, 0);
}

export function computeDues(
  subs: SubInfo[],
  confirmed: Set<string>, // `${subId}:${monthKey}`
  now = new Date(),
  lookbackMonths = 6,
): DueCharge[] {
  const dues: DueCharge[] = [];
  const curKey = monthKeyOf(now.getFullYear(), now.getMonth());
  // Límite inferior: max(startMonth, hace `lookback` meses).
  const minD = new Date(now.getFullYear(), now.getMonth() - lookbackMonths + 1, 1);
  const minKey = monthKeyOf(minD.getFullYear(), minD.getMonth());

  for (const s of subs) {
    if (!s.isActive) continue;
    const from = s.startMonth > minKey ? s.startMonth : minKey;
    const [fy, fm] = from.split("-").map(Number);
    const [cy, cm] = curKey.split("-").map(Number);
    const d = new Date(fy, fm - 1, 1);
    const end = new Date(cy, cm - 1, 1);
    while (d <= end) {
      const key = monthKeyOf(d.getFullYear(), d.getMonth());
      if (!confirmed.has(`${s.id}:${key}`)) {
        const date = chargeDate(key, s.chargeDay);
        dues.push({
          ...s,
          monthKey: key,
          monthLabel: monthLabelOf(key),
          dateISO: date.toISOString(),
          overdue: key < curKey,
          monthlyShare: s.isShared
            ? (s.shareAmount ?? (s.amount * s.sharePct) / 100)
            : null,
        });
      }
      d.setMonth(d.getMonth() + 1);
    }
  }

  return dues.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
}

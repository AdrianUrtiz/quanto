// Estados de cuenta de tarjetas de crédito (estilo banco).
//
// - El período lo marca el día de corte: (corte anterior + 1 día) → corte.
//   Sin día de corte se usa mes calendario.
// - Las compras a MSI se prorratean: cada período muestra solo su
//   parcialidad (`monto / meses`), como el banco real.
// - Los saldos (anterior, al corte, no exigible) se derivan de los
//   movimientos con montos totales, así que cuadran por construcción:
//   deudaAlCorte = anterior + parcialidades − pagos;
//   deudaTotal = deudaAlCorte + MSI aún no exigibles.

export type StatementTx = {
  id: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: number;
  concept: string;
  date: Date;
  accountId: string;
  transferToAccountId: string | null;
  installments: number;
};

export type StatementPeriod = {
  key: string; // "2026-10" (mes del corte)
  label: string; // "Octubre de 2026"
  chartLabel: string; // "OCT 26"
  start: Date; // 00:00, inclusive
  end: Date; // 23:59:59.999, inclusive
  dueDate: Date | null;
  dueLabel: string | null; // "26 de octubre"
  cutoffLabel: string; // "15 de octubre"
};

export type StatementMove = {
  id: string;
  date: Date;
  concept: string;
  kind: "charge" | "payment";
  amount: number;
  tag: string | null; // "2/3 MSI" | "Pago" | "Abono"
};

export type Statement = StatementPeriod & {
  prevDebt: number;
  charges: number;
  payments: number;
  closing: number; // pago para no generar intereses
  future: number; // MSI aún no exigibles
  moves: StatementMove[];
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function daysInMonth(y: number, m0: number) {
  return new Date(y, m0 + 1, 0).getDate();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function monthNameEs(d: Date) {
  return d.toLocaleDateString("es-MX", { month: "long" });
}

/** Fecha de la parcialidad i (0-based): mismo día, ajustado a fin de mes. */
export function installmentDate(buyDate: Date, i: number): Date {
  const d = new Date(buyDate.getFullYear(), buyDate.getMonth() + i, 1, 12, 0, 0);
  d.setDate(Math.min(buyDate.getDate(), daysInMonth(d.getFullYear(), d.getMonth())));
  return d;
}

/** Parcialidades con centavos exactos (la última absorbe el redondeo). */
export function installmentSchedule(amount: number, n: number): number[] {
  const k = Math.max(1, Math.round(n));
  if (k === 1) return [round2(amount)];
  const base = round2(amount / k);
  const out = Array(k - 1).fill(base);
  out.push(round2(amount - base * (k - 1)));
  return out;
}

export type StatementOpts = { statementDay?: number | null; dueDay?: number | null };

function normCut(statementDay?: number | null): number | null {
  return statementDay && statementDay >= 1 && statementDay <= 31 ? Math.round(statementDay) : null;
}

/** Período que termina el corte del mes (ey, em). */
function periodWithEnd(ey: number, em: number, opts: StatementOpts): StatementPeriod {
  const cut = normCut(opts.statementDay);
  const dim = daysInMonth(ey, em);
  const endDay = cut != null ? Math.min(cut, dim) : dim;
  const end = endOfDay(new Date(ey, em, endDay));
  // El inicio es el día siguiente al corte del mes anterior.
  const py = em - 1 < 0 ? ey - 1 : ey;
  const pm = em - 1 < 0 ? 11 : em - 1;
  const pEnd = new Date(py, pm, cut != null ? Math.min(cut, daysInMonth(py, pm)) : daysInMonth(py, pm));
  const start = startOfDay(new Date(pEnd.getFullYear(), pEnd.getMonth(), pEnd.getDate() + 1));

  const key = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}`;
  const label = cap(end.toLocaleDateString("es-MX", { month: "long", year: "numeric" }));
  const chartLabel = `${end.toLocaleDateString("es-MX", { month: "short" }).replace(".", "").toUpperCase()} ${String(end.getFullYear()).slice(2)}`;
  const cutoffLabel = `${end.getDate()} de ${monthNameEs(end)}`;

  let dueDate: Date | null = null;
  let dueLabel: string | null = null;
  if (opts.dueDay && opts.dueDay >= 1 && opts.dueDay <= 31) {
    const dy = em + 1 > 11 ? ey + 1 : ey;
    const dm = em + 1 > 11 ? 0 : em + 1;
    dueDate = new Date(dy, dm, Math.min(Math.round(opts.dueDay), daysInMonth(dy, dm)), 12, 0, 0);
    dueLabel = `${dueDate.getDate()} de ${monthNameEs(dueDate)}`;
  }

  return { key, label, chartLabel, start, end, dueDate, dueLabel, cutoffLabel };
}

/** Período de corte que contiene la fecha dada. */
export function periodContaining(d: Date, opts: StatementOpts): StatementPeriod {
  const cut = normCut(opts.statementDay);
  const day = startOfDay(d);
  let ey = d.getFullYear();
  let em = d.getMonth();
  const dim = daysInMonth(ey, em);
  const thisEnd = startOfDay(new Date(ey, em, cut != null ? Math.min(cut, dim) : dim));
  if (thisEnd < day) {
    em += 1;
    if (em > 11) { em = 0; ey += 1; }
  }
  return periodWithEnd(ey, em, opts);
}

/**
 * Últimos `count` períodos de corte (el primero es el vigente).
 * Corte día `d`: el período termina el día d del mes y empieza al día
 * siguiente del corte anterior.
 */
export function statementPeriods(
  opts: StatementOpts,
  now = new Date(),
  count = 8,
): StatementPeriod[] {
  const cur = periodContaining(now, opts);
  const out: StatementPeriod[] = [cur];
  let ey = cur.end.getFullYear();
  let em = cur.end.getMonth();
  for (let i = 1; i < count; i++) {
    em -= 1;
    if (em < 0) { em = 11; ey -= 1; }
    out.push(periodWithEnd(ey, em, opts));
  }
  return out;
}

/**
 * Períodos con actividad real, derivados de la consulta: línea de tiempo
 * continua desde el primer movimiento hasta la última parcialidad MSI,
 * siempre incluyendo el vigente. Para que la gráfica no quede vacía se
 * rellena hacia el pasado con períodos en cero hasta un mínimo de barras.
 */
export function activePeriods(
  cardId: string,
  txs: StatementTx[],
  opts: StatementOpts,
  now = new Date(),
): { statements: Statement[]; currentKey: string } {
  const current = periodContaining(now, opts);
  let minT = now.getTime();
  let maxT = now.getTime();
  for (const tx of txs) {
    if (tx.accountId !== cardId && tx.transferToAccountId !== cardId) continue;
    minT = Math.min(minT, tx.date.getTime());
    if (tx.type === "EXPENSE" && tx.accountId === cardId) {
      const n = Math.max(1, Math.round(tx.installments));
      maxT = Math.max(maxT, installmentDate(tx.date, n - 1).getTime());
    } else {
      maxT = Math.max(maxT, tx.date.getTime());
    }
  }

  const from = periodContaining(new Date(minT), opts);
  const to = periodContaining(new Date(maxT), opts);
  const periods: StatementPeriod[] = [];
  let ey = from.end.getFullYear();
  let em = from.end.getMonth();
  const toKey = to.end.getFullYear() * 12 + to.end.getMonth();
  for (;;) {
    periods.push(periodWithEnd(ey, em, opts));
    if (ey * 12 + em >= toKey) break;
    em += 1;
    if (em > 11) { em = 0; ey += 1; }
  }
  periods.reverse(); // newest-first

  // Relleno para la gráfica: mínimo MIN_BARS barras. Los futuros con MSI ya
  // vienen incluidos; aquí se completa hacia el pasado con períodos en cero
  // (anteriores al primer movimiento, así que no tienen cargos ni pagos).
  const MIN_BARS = 8;
  const allPeriods = [...periods]; // newest-first
  while (allPeriods.length < MIN_BARS) {
    const oldest = allPeriods[allPeriods.length - 1];
    let ey = oldest.end.getFullYear();
    let em = oldest.end.getMonth() - 1;
    if (em < 0) { em = 11; ey -= 1; }
    allPeriods.push(periodWithEnd(ey, em, opts));
  }
  const statements = buildStatements(cardId, txs, allPeriods)
    .sort((a, b) => (a.end.getTime() < b.end.getTime() ? 1 : -1));
  return { statements, currentKey: current.key };
}

/** Deuda de la tarjeta a fecha T (montos totales, no prorrateados). */
export function debtAt(cardId: string, txs: StatementTx[], t: Date): number {
  const time = t.getTime();
  let debt = 0;
  for (const tx of txs) {
    if (tx.date.getTime() > time) continue;
    if (tx.type === "EXPENSE" && tx.accountId === cardId) debt += tx.amount;
    else if (tx.type === "INCOME" && tx.accountId === cardId) debt -= tx.amount;
    else if (tx.type === "TRANSFER" && tx.transferToAccountId === cardId) debt -= tx.amount;
    else if (tx.type === "TRANSFER" && tx.accountId === cardId) debt += tx.amount;
  }
  return round2(debt);
}

function isPayment(cardId: string, tx: StatementTx) {
  return (
    (tx.type === "INCOME" && tx.accountId === cardId) ||
    (tx.type === "TRANSFER" && tx.transferToAccountId === cardId)
  );
}

function inRange(t: number, s: number, e: number) {
  return t >= s && t <= e;
}

/**
 * Estados de cuenta de los períodos (recibe los períodos newest-first, como
 * los genera `statementPeriods`, y devuelve los estados en el mismo orden).
 * Matemática de banco: cierre[i] = cierre[i-1] + parcialidades − pagos.
 * El período más antiguo se siembra con parcialidades/pagos previos a la
 * ventana para no perder MSI largos.
 */
export function buildStatements(cardId: string, txs: StatementTx[], periods: StatementPeriod[]): Statement[] {
  const asc = [...periods].reverse();
  const oldestStart = asc.length ? asc[0].start.getTime() : 0;

  // Parcialidades de un gasto (todas, sin filtrar por ventana).
  const schedules = txs
    .filter((tx) => tx.type === "EXPENSE" && tx.accountId === cardId)
    .map((tx) => {
      const n = Math.max(1, Math.round(tx.installments));
      const parts = installmentSchedule(tx.amount, n);
      return { tx, n, parts };
    });

  let seed = 0;
  for (const { tx, n, parts } of schedules) {
    for (let i = 0; i < n; i++) {
      if (installmentDate(tx.date, i).getTime() < oldestStart) seed = round2(seed + parts[i]);
    }
  }
  for (const tx of txs) {
    if (isPayment(cardId, tx) && tx.date.getTime() < oldestStart) seed = round2(seed - tx.amount);
  }

  let prev = seed;
  const byKey = new Map<string, Statement>();
  for (const period of asc) {
    const s = period.start.getTime();
    const e = period.end.getTime();
    const moves: StatementMove[] = [];
    let charges = 0;
    let payments = 0;

    for (const { tx, n, parts } of schedules) {
      for (let i = 0; i < n; i++) {
        const d = installmentDate(tx.date, i);
        if (!inRange(d.getTime(), s, e)) continue;
        charges = round2(charges + parts[i]);
        moves.push({
          id: `${tx.id}:${i}`,
          date: d,
          concept: tx.concept,
          kind: "charge",
          amount: parts[i],
          tag: n > 1 ? `${i + 1}/${n} MSI` : null,
        });
      }
    }
    for (const tx of txs) {
      if (!isPayment(cardId, tx) || !inRange(tx.date.getTime(), s, e)) continue;
      payments = round2(payments + tx.amount);
      moves.push({
        id: tx.id,
        date: tx.date,
        concept: tx.concept,
        kind: "payment",
        amount: round2(tx.amount),
        tag: tx.type === "TRANSFER" ? "Pago" : "Abono",
      });
    }

    moves.sort((a, b) => b.date.getTime() - a.date.getTime());

    const prevDebt = prev;
    const closing = round2(prevDebt + charges - payments);
    const debtEnd = debtAt(cardId, txs, period.end);
    const future = Math.max(0, round2(debtEnd - closing));
    byKey.set(period.key, { ...period, prevDebt, charges, payments, closing, future, moves });
    prev = closing;
  }
  return periods.map((p) => byKey.get(p.key)!);
}

// apps/backoffice/src/reports/report.viewmodels.ts
// P1-6: view-model'и шести отчётных экранов.
// Анализ: QR — 22 готовых отчёта (по дням, часам, официантам, блюдам,
// столам, «Сравнительный анализ»); Poster — «анализ = чек-лист действий»
// (их статья how-to-analyze-reports). Наши правила сверх рынка:
//  1) каждый экран отвечает на ВОПРОС владельца, а не «показывает данные»
//  2) сравнение с прошлым периодом ВЕЗДЕ (у QR — отдельный отчёт, у нас в каждом)
//  3) подсказки действий в ABC (Poster-философия, доведённая до строк)
//  4) P&L со строкой налога КЗ и «прибылью после налога» — наша монополия

export type Money = number;

export interface Delta { value: number; prevValue: number; diffPct: number | null }

export function delta(value: number, prevValue: number): Delta {
  return {
    value, prevValue,
    // округление ОТ НУЛЯ: −37.5% → −38% (Math.round тянет к +∞ — пойман тестом)
    diffPct: prevValue > 0
      ? (() => { const x = (100 * (value - prevValue)) / prevValue;
                 return Math.sign(x) * Math.round(Math.abs(x)); })()
      : null,
  };
}

// ═══════════════ 1. ПРОДАЖИ («Сколько я заработал?») ═══════════════

export interface SaleRow {
  at: Date; total: Money; waiterId?: string; waiterName?: string;
  categoryId?: string; categoryName?: string;
}

export function salesReport(cur: SaleRow[], prev: SaleRow[]) {
  const sum = (rows: SaleRow[]) => rows.reduce((s, r) => s + r.total, 0);
  const revenue = delta(sum(cur), sum(prev));
  const checks = delta(cur.length, prev.length);
  const avg = delta(
    cur.length ? Math.round(sum(cur) / cur.length) : 0,
    prev.length ? Math.round(sum(prev) / prev.length) : 0,
  );
  // По дням (QR «По дням»)
  const byDay = new Map<string, Money>();
  for (const r of cur) {
    const k = r.at.toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + r.total);
  }
  // По часам → час пик (QR «По часам», наша подача: сразу вывод)
  const byHour = new Array(24).fill(0) as Money[];
  for (const r of cur) byHour[r.at.getHours()] += r.total;
  const peakHour = byHour.indexOf(Math.max(...byHour));
  // По официантам (QR «По официантам»)
  const byWaiter = new Map<string, { name: string; total: Money; checks: number }>();
  for (const r of cur) {
    if (!r.waiterId) continue;
    const w = byWaiter.get(r.waiterId) ?? { name: r.waiterName ?? '', total: 0, checks: 0 };
    w.total += r.total; w.checks++;
    byWaiter.set(r.waiterId, w);
  }
  return {
    revenue, checks, avg,
    byDay: [...byDay.entries()].sort(),
    byHour, peakHour,
    byWaiter: [...byWaiter.values()].sort((a, b) => b.total - a.total),
  };
}

// ═══════════════ 2. ЧЕКИ («Что происходило на кассе?») ═══════════════
// QR «Отчёт по чекам» (10K): фильтры, история заказа, «заказы без чека».

export interface CheckRow {
  orderId: string; number: number; closedAt: Date; total: Money;
  paymentKinds: string[]; hasRemovedItems: boolean; fiscalStatus: 'SENT' | 'QUEUED' | 'ERROR' | 'NONE';
  waiterName?: string;
}

export interface CheckFilters {
  paymentKind?: string;
  onlyWithRemoved?: boolean;  // чеки с удалениями — контроль злоупотреблений
  onlyFiscalProblems?: boolean;
  search?: string;            // по номеру
}

export function filterChecks(rows: CheckRow[], f: CheckFilters): CheckRow[] {
  return rows.filter((r) => {
    if (f.paymentKind && !r.paymentKinds.includes(f.paymentKind)) return false;
    if (f.onlyWithRemoved && !r.hasRemovedItems) return false;
    if (f.onlyFiscalProblems && (r.fiscalStatus === 'SENT' || r.fiscalStatus === 'NONE')) return false;
    if (f.search && !String(r.number).includes(f.search)) return false;
    return true;
  });
}

/** Сводка проблем — сразу над списком (наша подача: сначала вывод). */
export function checksSummary(rows: CheckRow[]) {
  return {
    count: rows.length,
    total: rows.reduce((s, r) => s + r.total, 0),
    withRemoved: rows.filter((r) => r.hasRemovedItems).length,
    fiscalProblems: rows.filter((r) => r.fiscalStatus === 'QUEUED' || r.fiscalStatus === 'ERROR').length,
  };
}

// ═══════════════ 3–4. P&L и CASH FLOW — обвязка готовых pnl()/cashFlow() ═══
// Наши строки поверх: налог КЗ и «после налога» уже в pnl() Этапа 5.
// Здесь — подача: каждая строка с дельтой к прошлому периоду.

export interface PnlView {
  revenue: Delta; cogs: Delta; grossProfit: Delta;
  opex: Delta; tax: Delta; netProfit: Delta;
  foodcostPct: { cur: number; prev: number };
}

export function pnlView(cur: { revenue: Money; cogs: Money; opex: Money; tax: Money; netProfit: Money },
                        prev: { revenue: Money; cogs: Money; opex: Money; tax: Money; netProfit: Money }): PnlView {
  const gp = (x: typeof cur) => x.revenue - x.cogs;
  return {
    revenue: delta(cur.revenue, prev.revenue),
    cogs: delta(cur.cogs, prev.cogs),
    grossProfit: delta(gp(cur), gp(prev)),
    opex: delta(cur.opex, prev.opex),
    tax: delta(cur.tax, prev.tax),
    netProfit: delta(cur.netProfit, prev.netProfit),
    foodcostPct: {
      cur: cur.revenue ? +((100 * cur.cogs) / cur.revenue).toFixed(1) : 0,
      prev: prev.revenue ? +((100 * prev.cogs) / prev.revenue).toFixed(1) : 0,
    },
  };
}

// ═══════════════ 5. ABC с подсказками действий ═══════════════
// Poster-философия «что делать», доведённая до каждой строки.

export interface AbcRowIn { productId: string; name: string; revenueClass: 'A'|'B'|'C'; marginClass: 'A'|'B'|'C' }

export function abcHint(r: AbcRowIn): string {
  const k = r.revenueClass + r.marginClass;
  const map: Record<string, string> = {
    AA: 'Звезда — берегите качество и наличие',
    AB: 'Продаётся отлично — проверьте себестоимость, можно поднять маржу',
    AC: 'Трафик-мейкер: продаёт много, зарабатывает мало — поднимите цену или снизьте фудкост',
    BA: 'Маржинальный середняк — продвигайте (фото в меню, рекомендации официантов)',
    BB: 'Крепкий середняк — не трогайте',
    BC: 'Слабая маржа — пересмотрите техкарту',
    CA: 'Скрытая жемчужина: высокая маржа, мало продаж — продвигайте в топ меню',
    CB: 'Кандидат на замену позиции',
    CC: 'Балласт — уберите из меню или переработайте',
  };
  return map[k] ?? '';
}

// ═══════════════ 6. ЗАРПЛАТНАЯ ВЕДОМОСТЬ ═══════════════
// QR «По персоналу» + наша подача: разбивка начисления по компонентам.

export interface SalaryRowIn {
  userId: string; name: string; role: string;
  baseSalary: Money; hourly: Money; salesPct: Money; // из accrual() Этапа 5
  advances: Money; // авансы за период
}

export function salaryStatement(rows: SalaryRowIn[]) {
  const out = rows.map((r) => ({
    ...r,
    accrued: r.baseSalary + r.hourly + r.salesPct,
    toPay: r.baseSalary + r.hourly + r.salesPct - r.advances,
  }));
  return {
    rows: out.sort((a, b) => b.toPay - a.toPay),
    totalAccrued: out.reduce((s, r) => s + r.accrued, 0),
    totalToPay: out.reduce((s, r) => s + r.toPay, 0),
  };
}

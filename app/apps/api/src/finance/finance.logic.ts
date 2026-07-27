// apps/api/src/finance/finance.logic.ts
// Чистая логика отчётов. Главный принцип (методичка Poster «почему суммы
// расходятся»): P&L — ПО НАЧИСЛЕНИЮ (продажи и их себестоимость в момент
// продажи), Cash Flow — ПО ДЕНЬГАМ (когда деньги реально пришли/ушли).
// Оба отчёта строятся из одних первичных данных — расходиться могут только
// объяснимо (долги поставщикам, предоплаты, инкассации).

export type Money = number; // тиыны

// ═══════════════ P&L (по начислению) ═══════════════

export interface PnlInput {
  revenue: Money;        // выручка закрытых заказов (после скидок)
  cogs: Money;           // себестоимость проданного (из складских движений SALE)
  expensesByCat: { name: string; amount: Money }[]; // аренда, ФОТ, коммуналка...
  taxRegime?: { type: 'simplified_3pct' } | { type: 'none' };
}

export interface Pnl {
  revenue: Money;
  cogs: Money;
  grossProfit: Money;
  grossMarginPct: number;
  expenses: Money;
  operatingProfit: Money;
  tax: Money;
  netProfit: Money;
}

export function pnl(i: PnlInput): Pnl {
  const grossProfit = i.revenue - i.cogs;
  const expenses = i.expensesByCat.reduce((s, e) => s + e.amount, 0);
  const operatingProfit = grossProfit - expenses;
  // Налог КЗ: упрощёнка 3% с ОБОРОТА (реалия малого бизнеса КЗ — конкуренты
  // не считают, мы показываем сразу; предвидение будущих режимов — enum)
  const tax = i.taxRegime?.type === 'simplified_3pct' ? Math.round(i.revenue * 0.03) : 0;
  return {
    revenue: i.revenue, cogs: i.cogs, grossProfit,
    grossMarginPct: i.revenue > 0 ? +(100 * grossProfit / i.revenue).toFixed(1) : 0,
    expenses, operatingProfit, tax, netProfit: operatingProfit - tax,
  };
}

// ═══════════════ CASH FLOW (по деньгам) ═══════════════

export interface FinTx {
  finAccountId: string;
  toFinAccountId?: string;
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amount: Money;
  category: string;
}

export interface CashFlow {
  inflow: Money;
  outflow: Money;
  net: Money;
  byCategory: { category: string; amount: Money }[]; // ± по категориям
  accountBalances: Map<string, Money>;               // остатки счетов
}

export function cashFlow(opening: Map<string, Money>, txs: FinTx[]): CashFlow {
  const bal = new Map(opening);
  const cat = new Map<string, Money>();
  let inflow = 0, outflow = 0;
  const add = (acc: string, d: Money) => bal.set(acc, (bal.get(acc) ?? 0) + d);
  for (const t of txs) {
    if (t.kind === 'TRANSFER') {
      // перевод НЕ доход и НЕ расход (частая ошибка учёта — Poster предупреждает)
      add(t.finAccountId, -t.amount);
      if (t.toFinAccountId) add(t.toFinAccountId, t.amount);
      continue;
    }
    const sign = t.kind === 'INCOME' ? 1 : -1;
    add(t.finAccountId, sign * t.amount);
    cat.set(t.category, (cat.get(t.category) ?? 0) + sign * t.amount);
    if (sign > 0) inflow += t.amount; else outflow += t.amount;
  }
  return {
    inflow, outflow, net: inflow - outflow,
    byCategory: [...cat].map(([category, amount]) => ({ category, amount })),
    accountBalances: bal,
  };
}

// ═══════════════ ABC-АНАЛИЗ ═══════════════
// Poster: три показателя — выручка, количество, МАРЖА (прибыль). Акции и
// бесплатные чеки учитываются тем, что анализ ведётся по фактической выручке
// и фактической марже (после скидок). Классы по кумулятивной доле: A 80%,
// B до 95%, C остальное.

export interface AbcItem { productId: string; value: number }
export type AbcClass = 'A' | 'B' | 'C';

export function abc(items: AbcItem[]): Map<string, AbcClass> {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + Math.max(0, i.value), 0);
  const out = new Map<string, AbcClass>();
  let cum = 0;
  for (const it of sorted) {
    cum += Math.max(0, it.value);
    const share = total > 0 ? cum / total : 1;
    out.set(it.productId, share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C');
  }
  return out;
}

// ═══════════════ RFM (каркас — наполнение в Этапе 6) ═══════════════
// QuickResto: Recency/Frequency/Monetary по 3 уровня → сегменты для рассылок.

export interface RfmInput { daysSinceLast: number; ordersCount: number; totalSpent: Money }
export interface RfmScore { r: 1|2|3; f: 1|2|3; m: 1|2|3; segment: string }

export function rfm(i: RfmInput, cfg = {
  rDays: [30, 90] as [number, number],       // ≤30 → 3; ≤90 → 2; иначе 1
  fOrders: [2, 5] as [number, number],       // ≥5 → 3; ≥2 → 2; иначе 1
  mSpent: [50_000_00, 200_000_00] as [number, number], // тиыны
}): RfmScore {
  const r = i.daysSinceLast <= cfg.rDays[0] ? 3 : i.daysSinceLast <= cfg.rDays[1] ? 2 : 1;
  const f = i.ordersCount >= cfg.fOrders[1] ? 3 : i.ordersCount >= cfg.fOrders[0] ? 2 : 1;
  const m = i.totalSpent >= cfg.mSpent[1] ? 3 : i.totalSpent >= cfg.mSpent[0] ? 2 : 1;
  const segment =
    r === 3 && f === 3 ? 'Чемпионы' :
    r === 3 && f <= 2 ? 'Новички' :
    r === 2 && f >= 2 ? 'Лояльные' :
    r === 1 && f >= 2 ? 'Уходящие' : 'Спящие';
  return { r: r as 1|2|3, f: f as 1|2|3, m: m as 1|2|3, segment };
}

// ═══════════════ ЗАРПЛАТА ═══════════════
// QuickResto-модель: правило на должность, переопределение на сотрудника.
// Компоненты суммируются: оклад (пропорционально дням) + часы + % личных продаж.

export interface SalaryRuleDef {
  monthlyBase: Money;
  hourlyRate: Money;
  salesPct: number; // 0..100
}

export function pickRule(roleRule?: SalaryRuleDef, userRule?: SalaryRuleDef): SalaryRuleDef {
  return userRule ?? roleRule ?? { monthlyBase: 0, hourlyRate: 0, salesPct: 0 };
}

export function minutesWorked(shifts: { clockIn: Date; clockOut?: Date; adjustedMinutes?: number | null }[]): number {
  let m = 0;
  for (const s of shifts) {
    if (typeof s.adjustedMinutes === 'number') { m += s.adjustedMinutes; continue; }
    if (!s.clockOut) continue; // незакрытая смена не считается (закроет менеджер)
    m += Math.max(0, Math.round((s.clockOut.getTime() - s.clockIn.getTime()) / 60000));
  }
  return m;
}

export function accrual(
  rule: SalaryRuleDef,
  workedMinutes: number,
  personalSales: Money,
  daysInPeriod: number,
  daysWorkedShare: number, // 0..1 — доля отработанных дней для оклада
): { base: Money; hourly: Money; sales: Money; total: Money } {
  const base = Math.round(rule.monthlyBase * daysWorkedShare);
  const hourly = Math.round((workedMinutes / 60) * rule.hourlyRate);
  const sales = Math.round(personalSales * rule.salesPct / 100);
  return { base, hourly, sales, total: base + hourly + sales };
}

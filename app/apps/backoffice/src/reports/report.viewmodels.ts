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

/** Подзаголовок отчёта с контекстом — из макета: «Продажи · июль 2026 · 24 дня · точка Абая». */
export function reportSubtitle(parts: (string | number | null | undefined)[]): string {
  return parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ');
}

/** Вывод по часу пик — из макета: «в этот час поставьте второго кассира». */
export function peakAdvice(byHour: Money[], peakHour: number): string | null {
  const total = byHour.reduce((s, v) => s + v, 0);
  if (!total) return null;
  const share = byHour[peakHour] / total;
  return share >= 0.18
    ? 'в этот час поставьте второго кассира'
    : 'нагрузка распределена ровно';
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

export const CHECK_FILTERS = {
  all:     { ru: 'Все чеки', kk: 'Барлық чектер' },
  removed: { ru: 'С удалениями', kk: 'Жоюлармен' },
  fiscal:  { ru: 'Проблемы фискализации', kk: 'Фискалдау мәселелері' },
} as const;

export const CHECK_EMPTY = {
  noRemovals: { ru: 'Удалений за день не было', kk: 'Күн ішінде жою болған жоқ' },
  allSent:    { ru: 'Все чеки ушли в ОФД', kk: 'Барлық чектер ОФД-ға кетті' },
  clean:      { ru: 'всё чисто', kk: 'бәрі таза' },
} as const;

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

// ═══ НАЗВАНИЯ КЛАССОВ ABC — из макета «Пять отчётов» ═══
export const ABC_GROUP = {
  feeds:  { ru: 'Кормят бизнес', kk: 'Бизнесті асырайды' },
  hold:   { ru: 'Держат меню', kk: 'Мәзірді ұстайды' },
  ballast:{ ru: 'Балласт', kk: 'Балласт' },
} as const;

/** Группа позиции для секций отчёта (макет делит таблицу на три блока). */
export function abcGroup(r: AbcRowIn): keyof typeof ABC_GROUP {
  if (r.revenueClass === 'A') return 'feeds';
  if (r.revenueClass === 'C' && r.marginClass === 'C') return 'ballast';
  return 'hold';
}

/** Короткое имя роли позиции — из макета. */
export function abcRole(r: AbcRowIn): string {
  const k = r.revenueClass + r.marginClass;
  const map: Record<string, string> = {
    AA: 'Звезда', AB: 'Локомотив', AC: 'Трафик-мейкер',
    BA: 'Маржинальный середняк', BB: 'Крепкий середняк', BC: 'Слабая маржа',
    CA: 'Скрытая жемчужина', CB: 'Кандидат на замену', CC: 'Балласт',
  };
  return map[k] ?? '';
}

export function abcHint(r: AbcRowIn): string {
  const k = r.revenueClass + r.marginClass;
  // формулировки — из макета Claude Design: не диагноз, а конкретное действие
  const map: Record<string, string> = {
    AA: 'Продаётся сам. Проверьте порцию — граммовка ползёт вверх.',
    AB: 'Держите в наличии всегда: даёт заметную долю выручки.',
    AC: 'Поднимите цену на 100 ₸ — спрос это выдержит.',
    BA: 'Поставьте выше в меню и предложите к сорпе.',
    BB: 'Работает по вечерам. Оставьте как есть.',
    BC: 'Продаётся ровно. Здесь ищем, что можно поднять в цене.',
    CA: 'Маржа высокая — предлагайте к каждому горячему.',
    CB: 'Замените на позицию того же класса, но местную.',
    CC: 'Уберите из меню: фудкост высокий, продаж почти нет.',
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


// ═══════════════════════════════════════════════════════════
// ОТЧЁТ «ПРИБЫЛЬ» — ТОЧНО по макету «Бэк-офис — Прибыль»
// ═══════════════════════════════════════════════════════════

/** Строки P&L с пояснениями — состав и формулировки из макета. */
export const PNL_LINES = [
  { key: 'revenue',  title: 'Выручка',            note: 'фискальные чеки, наличные и Kaspi', sign: 1,  strong: false },
  { key: 'cogs',     title: 'Себестоимость блюд', note: 'по техкартам, фудкост',             sign: -1, strong: false },
  { key: 'gross',    title: 'Валовая прибыль',    note: 'выручка минус продукты',            sign: 1,  strong: true  },
  { key: 'salary',   title: 'Зарплата и смены',   note: 'вечерняя смена дороже',             sign: -1, strong: false },
  { key: 'rent',     title: 'Аренда',             note: '',                                  sign: -1, strong: false },
  { key: 'utility',  title: 'Коммунальные',       note: 'свет, вода, вывоз',                 sign: -1, strong: false },
  { key: 'marketing',title: 'Маркетинг',          note: 'таргет и печать меню',              sign: -1, strong: false },
  { key: 'writeoff', title: 'Списания и порча',   note: '',                                  sign: -1, strong: false },
  { key: 'other',    title: 'Прочее',             note: 'хозтовары, ремонт, интернет',       sign: -1, strong: false },
  { key: 'tax',      title: 'Налог 3% с оборота', note: 'ИП на упрощённом режиме, Казахстан',sign: -1, strong: false },
  { key: 'net',      title: 'Чистая прибыль',     note: 'то, что осталось у вас',            sign: 1,  strong: true  },
] as const;

export const PNL_VIEW = {
  inTenge:  { ru: 'Показать в тенге', kk: 'Теңгемен көрсету' },
  inPct:    { ru: 'Показать в % от выручки', kk: 'Түсімнен % көрсету' },
  exportXls:{ ru: 'Выгрузить в Excel', kk: 'Excel-ге жүктеу' },
  forAcc:   { ru: 'Выгрузка для бухгалтера', kk: 'Бухгалтерге арналған жүктеу' },
  taxAuto:  { ru: 'Налог считается сам', kk: 'Салық өзі есептеледі' },
  colPct:   { ru: '% выр.', kk: '% түс.' },
} as const;

/** Периоды сравнения — из макета: «Июль», «Июнь», «Квартал». */
export const PNL_PERIODS = [
  { key: 'month',   title: 'Июль',    subtitle: 'Июль 2026 · 1–24 июля',   compare: 'К июню',    compareNote: 'к июню' },
  { key: 'prev',    title: 'Июнь',    subtitle: 'Июнь 2026 · 30 дней',     compare: 'К маю',     compareNote: 'к маю' },
  { key: 'quarter', title: 'Квартал', subtitle: 'II квартал + июль',       compare: 'К I кв.',   compareNote: 'к I кварталу' },
] as const;

/** Доля строки от выручки — для режима «в % от выручки». */
export function pctOfRevenue(value: number, revenue: number): number {
  return revenue > 0 ? +((100 * Math.abs(value)) / revenue).toFixed(1) : 0;
}

/** Значение строки в выбранном режиме отображения. */
export function pnlCellText(value: number, revenue: number, mode: 'money' | 'pct',
                            fmt: (n: number) => string): string {
  return mode === 'pct' ? `${pctOfRevenue(value, revenue)}%` : fmt(Math.abs(value));
}

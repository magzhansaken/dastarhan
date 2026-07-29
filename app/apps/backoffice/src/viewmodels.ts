// apps/backoffice/src/viewmodels.ts
// View-model'и бэк-офиса. Принцип из мастер-плана: НАВИГАЦИЯ ПО ЗАДАЧАМ
// («Принять поставку», не «Документ прихода») + язык владельца (Poster),
// глубина редакторов — QuickResto (статья «Блюда» 95K), но с ЖИВЫМ
// пересчётом фудкоста при каждом вводе (у QR цифра статична).

import { unitCost } from '@dastarhan/shared/menu/cost.service';
import type { CostContext } from '@dastarhan/shared/menu/cost.service';

export type Money = number;

// ═══════════════ НАВИГАЦИЯ ПО ЗАДАЧАМ ═══════════════
// Не «Справочники/Документы/Отчёты» (язык 1С у Paloma/r_keeper), а задачи
// владельца. Раздел видим, если модуль включён тарифом и вертикалью.

export interface NavSection { id: string; title: string; tasks: { id: string; title: string; route: string }[] }

export function buildNav(modules: Record<string, boolean>, vertical: string): NavSection[] {
  const nav: NavSection[] = [
    { id: 'today', title: 'Сегодня', tasks: [
      { id: 'dash', title: 'Как идут дела', route: '/dashboard' },
    ]},
    { id: 'menu', title: 'Меню', tasks: [
      { id: 'products', title: 'Блюда и цены', route: '/menu' },
      { id: 'techcards', title: 'Техкарты и фудкост', route: '/menu/techcards' },
    ]},
    { id: 'stock', title: 'Склад', tasks: [
      { id: 'supply', title: 'Принять поставку', route: '/stock/supply/new' },
      { id: 'inventory', title: 'Провести инвентаризацию', route: '/stock/inventory/new' },
      { id: 'balances', title: 'Остатки и движения', route: '/stock/balances' },
    ]},
    { id: 'money', title: 'Деньги', tasks: [
      { id: 'pnl', title: 'Прибыль (P&L)', route: '/finance/pnl' },
      { id: 'cashflow', title: 'Движение денег', route: '/finance/cashflow' },
      { id: 'salary', title: 'Зарплаты', route: '/finance/salary' },
    ]},
    { id: 'guests', title: 'Гости', tasks: [
      { id: 'customers', title: 'База гостей', route: '/guests' },
      { id: 'promos', title: 'Акции и бонусы', route: '/guests/promos' },
    ]},
  ];
  if (modules.delivery) nav.push({ id: 'delivery', title: 'Доставка', tasks: [
    { id: 'orders', title: 'Заказы на доставку', route: '/delivery' },
    { id: 'zones', title: 'Зоны и курьеры', route: '/delivery/zones' },
  ]});
  if (modules.ai) nav.push({ id: 'ai', title: 'Помощник', tasks: [
    { id: 'invoice', title: 'Загрузить накладную фото', route: '/ai/invoice' },
    { id: 'ask', title: 'Спросить о бизнесе', route: '/ai/ask' },
  ]});
  if (vertical === 'SALON') nav.splice(1, 0, { id: 'book', title: 'Записи', tasks: [
    { id: 'calendar', title: 'Календарь мастеров', route: '/appointments' },
  ]});
  if (vertical === 'BILLIARD') nav.splice(1, 0, { id: 'timed', title: 'Столы/время', tasks: [
    { id: 'resources', title: 'Тарифы столов', route: '/timed' },
  ]});
  return nav;
}

// ═══════════════ ДАШБОРД «КАК ИДУТ ДЕЛА» ═══════════════

export interface DashInput {
  todayRevenue: Money; yesterdaySameTime: Money;
  checks: number; avgCheck: Money;
  alerts: { severity: 'HIGH' | 'MEDIUM'; text: string }[];
  unsyncedTerminals: number;
}

export function dashCards(i: DashInput) {
  const diffPct = i.yesterdaySameTime > 0
    ? Math.round(100 * (i.todayRevenue - i.yesterdaySameTime) / i.yesterdaySameTime)
    : null;
  return {
    revenue: { value: i.todayRevenue, diffPct, tone: diffPct === null ? 'flat' : diffPct >= 0 ? 'up' : 'down' },
    checks: { value: i.checks, avg: i.avgCheck },
    attention: [
      ...(i.unsyncedTerminals > 0 ? [{ severity: 'HIGH' as const, text: `Кассы не в сети: ${i.unsyncedTerminals}` }] : []),
      ...i.alerts,
    ].slice(0, 5),
  };
}

// ═══════════════ РЕДАКТОР ТЕХКАРТЫ С ЖИВЫМ ФУДКОСТОМ ═══════════════

export interface TcLine {
  componentId: string; name: string; brutto: number; netto: number;
  unit?: string;          // «кг», «г» — для подписи остатка
  stockQty?: number;      // остаток на складе (из макета: «на складе 16,2 кг»)
  kind?: string;          // «полуфабрикат, своя техкарта» — из макета
  note?: string;          // «Потери 22% — чистка. Пассеруется в бульоне.»
}

export function lossPct(l: TcLine): number {
  if (l.brutto <= 0) return 0;
  return +((100 * (l.brutto - l.netto)) / l.brutto).toFixed(1);
}

/** Живой пересчёт при каждом вводе: себестоимость порции, фудкост %,
 *  маржа. Использует ТУ ЖЕ unitCost (Этап 1) — что в отчётах, то и в
 *  редакторе: цифры никогда не расходятся. */
export function liveCost(
  lines: TcLine[], outputQty: number, salePrice: Money, ctx: CostContext,
): { portionCost: Money; foodcostPct: number; margin: Money } {
  let total = 0;
  for (const l of lines) total += l.brutto * unitCost(l.componentId, ctx);
  const portionCost = Math.round(total);
  const foodcostPct = salePrice > 0 ? +((100 * portionCost) / salePrice).toFixed(1) : 0;
  return { portionCost, foodcostPct, margin: salePrice - portionCost };
}

// ═══ ТРИ УРОВНЯ ФУДКОСТА — из макета «Бэк-офис — Техкарта» ═══
export const FOODCOST_LEVEL = {
  ok:     { ru: 'В норме', kk: 'Қалыпты' },
  edge:   { ru: 'На границе', kk: 'Шекте' },
  high:   { ru: 'Дорого', kk: 'Қымбат' },
} as const;

/** Уровень фудкоста: до 30% норма, 30–38% граница, выше — дорого. */
export function foodcostLevel(pct: number): keyof typeof FOODCOST_LEVEL {
  return pct <= 30 ? 'ok' : pct <= 38 ? 'edge' : 'high';
}

/**
 * Прогноз запаса по компоненту — из макета: «на складе 16,2 кг, в порции 320 г.
 * При спросе 4 порции в день хватит на 12 дней».
 */
export function stockForecast(
  stockQty: number, perPortion: number, portionsPerDay: number,
): { portionsLeft: number; daysLeft: number | null } {
  if (perPortion <= 0) return { portionsLeft: 0, daysLeft: null };
  const portionsLeft = Math.floor(stockQty / perPortion);
  const daysLeft = portionsPerDay > 0 ? Math.floor(portionsLeft / portionsPerDay) : null;
  return { portionsLeft, daysLeft };
}

/** Маржа в контексте месяца — из макета: «На 118 порциях в месяц это N ₸». */
export function monthlyMargin(marginPerPortion: Money, portionsPerMonth: number): Money {
  return marginPerPortion * portionsPerMonth;
}

/** Валидации редактора (правила QR + здравый смысл). */
export function tcErrors(lines: TcLine[], outputQty: number): string[] {
  const errs: string[] = [];
  if (!lines.length) errs.push('Добавьте хотя бы один компонент');
  if (outputQty <= 0) errs.push('Укажите выход порции');
  lines.forEach((l, i) => {
    if (l.brutto <= 0) errs.push(`Строка ${i + 1}: брутто должно быть > 0`);
    if (l.netto > l.brutto) errs.push(`Строка ${i + 1}: нетто больше брутто — так не бывает`);
  });
  return errs;
}

// ═══════════════ ПРИХОД (документ поставки) ═══════════════

export interface SupplyLineVm { productId: string; name: string; qty: number; unitCostTenge: number }

export function supplyTotals(lines: SupplyLineVm[]): { total: Money; positions: number } {
  return {
    total: Math.round(lines.reduce((s, l) => s + l.qty * l.unitCostTenge * 100, 0)),
    positions: lines.filter((l) => l.qty > 0).length,
  };
}

export function supplyErrors(lines: SupplyLineVm[]): string[] {
  const errs: string[] = [];
  if (!lines.length) errs.push('Добавьте товары');
  lines.forEach((l, i) => {
    if (l.qty <= 0) errs.push(`${l.name || `Строка ${i + 1}`}: количество должно быть > 0`);
    if (l.unitCostTenge < 0) errs.push(`${l.name}: цена не может быть отрицательной`);
  });
  return errs;
}

// ═══════════════ ОНБОРДИНГ «15 МИНУТ ДО ЧЕКА» ═══════════════
// Paloma даёт «быстрые запуски» статьями — у нас мастер прямо в продукте.
// Шаги зависят от вертикали; прогресс сохраняется.

export interface OnbStep { id: string; title: string; done: boolean; minutes: number }

export function onboardingSteps(vertical: string, state: Record<string, boolean>): OnbStep[] {
  const base: [string, string, number][] = [
    ['org', 'Название и реквизиты (БИН)', 2],
    ['menu', vertical === 'SHOP' ? 'Загрузите товары (Excel или сканером)' : 'Добавьте 5 главных блюд', 5],
    ['staff', 'Добавьте кассира с PIN-кодом', 1],
    ['payments', 'Подключите Kaspi и наличные', 2],
    ['fiscal', 'Подключите Webkassa (или пропустите)', 3],
    ['print', 'Подключите принтер чеков', 2],
  ];
  if (vertical === 'SALON') base.splice(2, 0, ['masters', 'Мастера и услуги с длительностью', 3]);
  if (vertical === 'BILLIARD') base.splice(2, 0, ['tables', 'Столы и тарифы за час', 3]);
  return base.map(([id, title, minutes]) => ({ id, title, minutes, done: !!state[id] }));
}

export function onboardingProgress(steps: OnbStep[]): { pct: number; minutesLeft: number; nextStep?: OnbStep } {
  const done = steps.filter((s) => s.done);
  return {
    pct: Math.round((100 * done.length) / steps.length),
    minutesLeft: steps.filter((s) => !s.done).reduce((s, x) => s + x.minutes, 0),
    nextStep: steps.find((s) => !s.done),
  };
}

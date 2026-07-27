// apps/api/src/platform/billing.logic.ts
// БИЛЛИНГ-КАБИНЕТ КЛИЕНТА — логика (приложения не было).
// Анализ:
//  • Poster — эталон self-serve: счета и оплата подписки прямо в админ-панели.
//  • Paloma — постоплата: счёт в конце месяца, оплатить до 15 числа, и
//    прямая цитата из их базы: «ВНИМАНИЕ!!! Закрывающие документы в случае
//    оплаты картой получить будет нельзя!!!». Для казахстанского ИП/ТОО это
//    больно: бухгалтерии нужны акт и счёт-фактура.
//  • r_keeper — лицензии с автопродлением по подписке.
// Наши решения: предоплата с прозрачной разбивкой, оплата Kaspi в один тап
// И закрывающие документы автоматом на почту при любом способе оплаты.

import { proration, subscriptionPrice } from './platform.logic';

export type Money = number;

// ═══════════════ ТАРИФЫ ═══════════════

export interface Plan {
  key: 'START' | 'BUSINESS' | 'NETWORK';
  name: string;
  pricePerLocation: Money;
  includedTerminalsPerLocation: number;
  extraTerminalPrice: Money;
  summary: string;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    key: 'START', name: 'Старт', pricePerLocation: 12000_00,
    includedTerminalsPerLocation: 1, extraTerminalPrice: 4000_00,
    summary: 'Одна точка, касса и склад',
    features: ['Касса и офлайн-режим', 'Склад и техкарты', 'Базовые отчёты', 'Фискализация Webkassa/re:Kassa'],
  },
  {
    key: 'BUSINESS', name: 'Бизнес', pricePerLocation: 18000_00,
    includedTerminalsPerLocation: 1, extraTerminalPrice: 4000_00,
    summary: 'Доставка, лояльность, ИИ-помощник',
    features: ['Всё из «Старт»', 'Доставка и курьеры', 'Бонусы и акции', 'ИИ-помощник', 'Все отчёты и брони'],
  },
  {
    key: 'NETWORK', name: 'Сеть', pricePerLocation: 26000_00,
    includedTerminalsPerLocation: 2, extraTerminalPrice: 4000_00,
    summary: 'Центральный склад, франшиза',
    features: ['Всё из «Бизнес»', 'Центральный склад', 'Перемещения между точками', 'Франшиза и роялти'],
  },
];

export function planByKey(key: Plan['key']): Plan {
  const p = PLANS.find((x) => x.key === key);
  if (!p) throw new Error('UNKNOWN_PLAN');
  return p;
}

// ═══════════════ РАЗБИВКА ПЛАТЕЖА ═══════════════
// Владелец должен видеть, из чего складывается сумма — иначе каждый месяц
// звонок «почему столько?». У Paloma счёт приходит одной строкой.

export interface LocationBilling { id: string; name: string; address?: string; terminals: number }

export interface InvoiceLine { label: string; qty: number; unit: Money; sum: Money }

export function billingBreakdown(plan: Plan, locations: LocationBilling[]): {
  lines: InvoiceLine[]; total: Money; extraTerminals: number;
} {
  const base = subscriptionPrice(plan.pricePerLocation, locations.length);
  const extraTerminals = locations.reduce(
    (s, l) => s + Math.max(0, l.terminals - plan.includedTerminalsPerLocation), 0);
  const lines: InvoiceLine[] = [
    {
      label: `Тариф «${plan.name}» · ${locations.length} ${plural(locations.length, 'точка', 'точки', 'точек')}`,
      qty: locations.length, unit: plan.pricePerLocation, sum: base,
    },
  ];
  if (extraTerminals > 0) {
    lines.push({
      label: 'Дополнительные кассы',
      qty: extraTerminals, unit: plan.extraTerminalPrice,
      sum: extraTerminals * plan.extraTerminalPrice,
    });
  }
  return { lines, total: lines.reduce((s, l) => s + l.sum, 0), extraTerminals };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Сколько добавится к платежу при добавлении точки прямо сейчас.
 *  Макет обещает: «Добавили точку — цена пересчитается с этого дня». */
export function addLocationCost(
  plan: Plan, now: Date, periodEnd: Date, terminals = 1,
): { monthlyDelta: Money; chargeNow: Money; daysLeft: number } {
  const extra = Math.max(0, terminals - plan.includedTerminalsPerLocation) * plan.extraTerminalPrice;
  const monthlyDelta = plan.pricePerLocation + extra;
  const daysLeft = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000));
  const daysInMonth = 30;
  return {
    monthlyDelta,
    chargeNow: Math.round((monthlyDelta * daysLeft) / daysInMonth),
    daysLeft,
  };
}

/** Смена тарифа. Правило из макета: повышение — сразу с доплатой,
 *  понижение — со следующего периода (чтобы не возвращать деньги). */
export function planChange(
  from: Plan, to: Plan, locations: number, now: Date, periodEnd: Date,
): { direction: 'upgrade' | 'downgrade' | 'same'; effectiveFrom: Date; chargeNow: Money; note: string } {
  if (from.key === to.key) {
    return { direction: 'same', effectiveFrom: now, chargeNow: 0, note: 'Это ваш текущий тариф' };
  }
  const upgrade = to.pricePerLocation > from.pricePerLocation;
  if (!upgrade) {
    return {
      direction: 'downgrade', effectiveFrom: periodEnd, chargeNow: 0,
      note: 'Переход действует со следующего месяца — оплаченный период дорабатывает полностью',
    };
  }
  // proration ждёт (старая, новая, ДНЕЙ осталось, ДНЕЙ в периоде) и
  // возвращает объект — раньше сюда передавались даты, и доплата всегда
  // выходила нулевой (поймано тестом).
  const daysInPeriod = 30;
  const daysLeft = Math.min(daysInPeriod,
    Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000)));
  const { dueNow } = proration(
    subscriptionPrice(from.pricePerLocation, locations),
    subscriptionPrice(to.pricePerLocation, locations),
    daysLeft, daysInPeriod,
  );
  return {
    direction: 'upgrade', effectiveFrom: now, chargeNow: dueNow,
    note: 'Новые возможности включатся сразу, доплата — только за оставшиеся дни',
  };
}

// ═══════════════ СЧЕТА И ЗАКРЫВАЮЩИЕ ДОКУМЕНТЫ ═══════════════

export type InvoiceStatus = 'PAID' | 'PENDING' | 'OVERDUE' | 'REFUNDED';

export interface Invoice {
  id: string; number: string;
  periodFrom: Date; periodTo: Date;
  amount: Money; status: InvoiceStatus;
  paidAt?: Date | null; dueAt: Date;
  /** Когда счёт выставлен: предоплата формирует его заранее (дизайн-ревизия). */
  issuedAt?: Date;
  method?: 'kaspi' | 'card' | 'transfer';
}

export function invoiceStatusLabel(inv: Invoice, now: Date): { text: string; tone: 'ok' | 'warn' | 'danger' | 'dim' } {
  if (inv.status === 'PAID') return { text: 'Оплачен', tone: 'ok' };
  if (inv.status === 'REFUNDED') return { text: 'Возвращён', tone: 'dim' };
  const daysLate = Math.floor((now.getTime() - inv.dueAt.getTime()) / 86_400_000);
  if (inv.status === 'OVERDUE' || daysLate > 0) {
    return { text: `Просрочен на ${daysLate} ${plural(daysLate, 'день', 'дня', 'дней')}`, tone: 'danger' };
  }
  const daysLeft = Math.ceil((inv.dueAt.getTime() - now.getTime()) / 86_400_000);
  return { text: `Оплатить до ${fmtDate(inv.dueAt)} · ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}`, tone: 'warn' };
}

const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/** Закрывающие документы. У Paloma при оплате картой их получить НЕЛЬЗЯ —
 *  мы формируем всегда и на любой способ оплаты. */
export function closingDocs(inv: Invoice): { available: boolean; docs: string[]; note: string } {
  if (inv.status !== 'PAID') {
    return { available: false, docs: [], note: 'Документы придут на почту сразу после оплаты' };
  }
  return {
    available: true,
    docs: ['Счёт на оплату', 'Акт выполненных работ', 'Счёт-фактура'],
    note: 'Отправлены на почту бухгалтера. Способ оплаты значения не имеет.',
  };
}

// ═══════════════ ЧТО РАБОТАЕТ ПРИ НЕОПЛАТЕ ═══════════════
// Наш козырь: касса не гаснет. Показываем это честно и заранее.

export type BillingState = 'ACTIVE' | 'GRACE' | 'SUSPENDED';

export function billingState(inv: Invoice | null, now: Date, graceDays = 7): {
  state: BillingState; daysLeft: number; title: string; body: string;
} {
  if (!inv || inv.status === 'PAID') {
    return { state: 'ACTIVE', daysLeft: 0, title: 'Подписка активна', body: 'Всё работает. Следующий счёт придёт автоматически.' };
  }
  const daysLate = Math.floor((now.getTime() - inv.dueAt.getTime()) / 86_400_000);
  if (daysLate <= 0) {
    const left = Math.ceil((inv.dueAt.getTime() - now.getTime()) / 86_400_000);
    return {
      state: 'ACTIVE', daysLeft: left,
      title: `Счёт на ${fmtDate(inv.dueAt)}`,
      body: 'Оплатите до этой даты — ничего не изменится.',
    };
  }
  if (daysLate < graceDays) {
    return {
      state: 'GRACE', daysLeft: graceDays - daysLate,
      title: `Оплатите в течение ${graceDays - daysLate} ${plural(graceDays - daysLate, 'дня', 'дней', 'дней')}`,
      body: 'Касса работает как обычно — гости ничего не заметят. Отчёты и настройки откроются сразу после оплаты.',
    };
  }
  return {
    state: 'SUSPENDED', daysLeft: 0,
    title: 'Продажи приостановлены',
    body: 'Закрыть открытую смену и снять Z-отчёт можно всегда — деньги и история никуда не денутся.',
  };
}

/** Что именно работает в каждом состоянии — список для экрана.
 *  Никаких «доступ ограничен» без объяснений. */
export function whatWorks(state: BillingState): { name: string; ok: boolean }[] {
  return [
    { name: 'Продажи на кассе', ok: state !== 'SUSPENDED' },
    { name: 'Печать чеков и фискализация', ok: state !== 'SUSPENDED' },
    { name: 'Закрытие смены и Z-отчёт', ok: true },          // всегда — это закон
    { name: 'Отчёты и аналитика', ok: state === 'ACTIVE' },
    { name: 'Настройки и меню', ok: state === 'ACTIVE' },
    { name: 'Выгрузка своих данных', ok: true },              // данные клиента — его
  ];
}

// ═══════════════ ОТСРОЧКА ═══════════════
// Из макета: «дадим ещё 7 дней без вопросов. Один раз в квартал это нормально».

export function canRequestDeferral(
  lastDeferralAt: Date | null, now: Date, quarterDays = 90,
): { allowed: boolean; reason: string } {
  if (!lastDeferralAt) return { allowed: true, reason: 'Первая отсрочка — дадим без вопросов' };
  const days = Math.floor((now.getTime() - lastDeferralAt.getTime()) / 86_400_000);
  if (days >= quarterDays) return { allowed: true, reason: 'С прошлой отсрочки прошло больше квартала' };
  return {
    allowed: false,
    reason: `Отсрочку уже давали ${days} ${plural(days, 'день', 'дня', 'дней')} назад. Следующая — через ${quarterDays - days}. Напишите нам, если ситуация серьёзная.`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ДОПОЛНЕНИЕ ДИЗАЙН-РЕВИЗИИ: блокировка функций по тарифу
// В каталоге состояний Claude Design есть экран «Заблокировано по тарифу»:
// раздел с замком и текстом «Отчёт о прибыли доступен на тарифе Бизнес».
// В списке features у планов лежат ЧЕЛОВЕЧЕСКИЕ описания для страницы
// тарифов — по ним нельзя проверять доступ в коде. Нужен машинный слой.
// ═══════════════════════════════════════════════════════════════════

/** Машинные ключи возможностей. Тариф → что открыто. */
export const PLAN_FEATURES: Record<Plan['key'], string[]> = {
  START: [
    'pos', 'pos.offline', 'stock', 'techcards', 'fiscal',
    'reports.sales', 'reports.checks', 'staff',
  ],
  BUSINESS: [
    'pos', 'pos.offline', 'stock', 'techcards', 'fiscal',
    'reports.sales', 'reports.checks', 'staff',
    'delivery', 'loyalty', 'promos', 'ai', 'reservations',
    'reports.pnl', 'reports.cashflow', 'reports.abc', 'reports.salary',
    'guest.qr', 'telegram', 'tips',
  ],
  NETWORK: [
    'pos', 'pos.offline', 'stock', 'techcards', 'fiscal',
    'reports.sales', 'reports.checks', 'staff',
    'delivery', 'loyalty', 'promos', 'ai', 'reservations',
    'reports.pnl', 'reports.cashflow', 'reports.abc', 'reports.salary',
    'guest.qr', 'telegram', 'tips',
    'central_stock', 'transfers', 'franchise', 'multi_location_reports',
  ],
};

/** Человеческие названия возможностей — для текста замка. */
export const FEATURE_TITLES: Record<string, string> = {
  'delivery': 'Доставка и курьеры',
  'loyalty': 'Бонусы и лояльность',
  'promos': 'Акции и промокоды',
  'ai': 'ИИ-помощник',
  'reservations': 'Брони столов',
  'reports.pnl': 'Отчёт о прибыли',
  'reports.cashflow': 'Движение денег',
  'reports.abc': 'ABC-анализ меню',
  'reports.salary': 'Зарплатная ведомость',
  'guest.qr': 'QR-меню для гостей',
  'telegram': 'Telegram-бот заказов',
  'tips': 'Чаевые по QR',
  'central_stock': 'Центральный склад',
  'transfers': 'Перемещения между точками',
  'franchise': 'Франшиза и роялти',
  'multi_location_reports': 'Сводные отчёты по сети',
};

export function hasFeature(planKey: Plan['key'], feature: string): boolean {
  return (PLAN_FEATURES[planKey] ?? []).includes(feature);
}

/** Минимальный тариф, на котором функция появляется. */
export function minPlanFor(feature: string): Plan | null {
  for (const p of PLANS) {
    if (hasFeature(p.key, feature)) return p;
  }
  return null;
}

/** Экран «Заблокировано по тарифу». Возвращает null, если всё открыто —
 *  тогда UI просто рисует раздел. Текст объясняет ценность, а не запрет. */
export function featureLock(feature: string, currentPlan: Plan['key']): null | {
  title: string; body: string; cta: string; neededPlan: Plan['key']; priceDiff: Money;
} {
  if (hasFeature(currentPlan, feature)) return null;
  const need = minPlanFor(feature);
  if (!need) return null;
  const now = planByKey(currentPlan);
  return {
    title: `${FEATURE_TITLES[feature] ?? 'Эта возможность'} — на тарифе «${need.name}»`,
    body: need.summary,
    cta: 'Сравнить тарифы',
    neededPlan: need.key,
    priceDiff: Math.max(0, need.pricePerLocation - now.pricePerLocation),
  };
}

/** Что клиент потеряет при понижении тарифа — показываем ДО перехода,
 *  чтобы не было сюрприза «куда делась доставка». */
export function featuresLostOnDowngrade(from: Plan['key'], to: Plan['key']): string[] {
  const before = PLAN_FEATURES[from] ?? [];
  const after = PLAN_FEATURES[to] ?? [];
  return before
    .filter((f) => !after.includes(f))
    .map((f) => FEATURE_TITLES[f] ?? f);
}

// ═══════════════ ПРЕДОПЛАТНЫЙ СЧЁТ ═══════════════
// Poster выставляет счёт в админке заранее; Paloma — в конце месяца
// с оплатой до 15 числа (постоплата и ручные платёжки). Берём модель Poster
// и убираем человека совсем: счёт формируется автоматически за 5 дней.

export const INVOICE_LEAD_DAYS = 5;

export function nextInvoice(
  plan: Plan, locations: LocationBilling[], periodStart: Date, seq: number,
): Invoice {
  const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, periodStart.getDate());
  const breakdown = billingBreakdown(plan, locations);
  return {
    id: `inv_${seq}`,
    number: `DS-${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, '0')}-${String(seq).padStart(4, '0')}`,
    periodFrom: periodStart,
    periodTo: periodEnd,
    amount: breakdown.total,
    issuedAt: new Date(periodStart.getTime() - INVOICE_LEAD_DAYS * 86_400_000),
    dueAt: periodStart,
    status: 'PENDING',
  };
}

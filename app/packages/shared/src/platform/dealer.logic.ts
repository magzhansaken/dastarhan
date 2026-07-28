// apps/api/src/platform/dealer.logic.ts
// КАБИНЕТ ДИЛЕРА — логика (приложения не было, была только dealerCommission).
// Анализ:
//  • r_keeper Fordealers — самая проработанная партнёрская программа рынка
//    (229 статей: аккредитация, акцепт договора и NDA, демо-стенды,
//    Service Desk, эскалация заявок). Но регистрация клиента дилером —
//    бюрократия в 5 шагов через l.ucs со статусами заявки.
//  • Paloma — «как запускать клиентов партнёру», «как поддерживать клиента»:
//    методология продаж есть, кабинета с деньгами нет.
//  • Poster/QuickResto — партнёрство есть, публичной механики нет.
// Наши решения: комиссия RECURRING (пока клиент платит — дилер получает),
// автоматическая выплата без заявки, прогноз следующей выплаты и —
// главное — риск потери комиссии, когда клиент дилера начал отваливаться.

import { dealerCommission } from './platform.logic';

export type Money = number;

// ═══════════════ КЛИЕНТЫ ДИЛЕРА ═══════════════

export type DealerClientStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CHURNED';

export interface DealerClient {
  accountId: string;
  name: string;
  city?: string;
  status: DealerClientStatus;
  monthlyPayment: Money;      // сколько платит клиент в месяц
  signedAt: Date;
  trialEndsAt?: Date | null;
  lastPaymentAt?: Date | null;
}

/** Сводка портфеля дилера — четыре цифры из макета. */
export function dealerPortfolio(clients: DealerClient[], commissionPct: number, now: Date) {
  const paying = clients.filter((c) => c.status === 'ACTIVE' || c.status === 'PAST_DUE');
  const trial = clients.filter((c) => c.status === 'TRIAL');
  const monthlyBase = paying.reduce((s, c) => s + c.monthlyPayment, 0);
  // «на пробном, из них заканчивается на этой неделе» — повод позвонить
  const trialSoon = trial.filter((c) =>
    c.trialEndsAt && (c.trialEndsAt.getTime() - now.getTime()) / 86_400_000 <= 7).length;
  return {
    totalClients: clients.length,
    payingCount: paying.length,
    trialCount: trial.length,
    trialSoon,
    churnedCount: clients.filter((c) => c.status === 'CHURNED').length,
    monthlyBase,
    monthlyCommission: dealerCommission(monthlyBase, commissionPct),
  };
}

/** Комиссия по конкретному клиенту — колонка «Ваша комиссия» в таблице. */
export function clientCommission(c: DealerClient, commissionPct: number): Money {
  if (c.status !== 'ACTIVE' && c.status !== 'PAST_DUE') return 0;
  return dealerCommission(c.monthlyPayment, commissionPct);
}

/** Что дилеру делать с этим клиентом — колонка «Действие».
 *  Каждая строка ведёт к конкретному шагу, а не просто показывает статус. */
export function clientAction(c: DealerClient, now: Date): { label: string; urgency: 'high' | 'medium' | 'none' } {
  if (c.status === 'TRIAL') {
    const daysLeft = c.trialEndsAt
      ? Math.ceil((c.trialEndsAt.getTime() - now.getTime()) / 86_400_000) : null;
    if (daysLeft !== null && daysLeft <= 3) return { label: `Пробный кончается через ${daysLeft} дн — позвонить`, urgency: 'high' };
    return { label: 'На пробном — помочь с запуском', urgency: 'medium' };
  }
  if (c.status === 'PAST_DUE') return { label: 'Не оплатил — напомнить', urgency: 'high' };
  if (c.status === 'SUSPENDED') return { label: 'Продажи остановлены — вернуть', urgency: 'high' };
  if (c.status === 'CHURNED') return { label: 'Ушёл — узнать причину', urgency: 'medium' };
  return { label: '', urgency: 'none' };
}

/** Комиссия под риском: клиенты дилера, которые вот-вот перестанут платить.
 *  Дилер теряет деньги вместе с нами — пусть видит это в тенге. */
export function commissionAtRisk(clients: DealerClient[], commissionPct: number): {
  amount: Money; clients: number;
} {
  const risky = clients.filter((c) => c.status === 'PAST_DUE' || c.status === 'SUSPENDED');
  return {
    amount: risky.reduce((s, c) => s + dealerCommission(c.monthlyPayment, commissionPct), 0),
    clients: risky.length,
  };
}

// ═══════════════ НАЧИСЛЕНИЯ И ВЫПЛАТЫ ═══════════════

export type PayoutStatus = 'PAID' | 'SCHEDULED' | 'PENDING';

export interface MonthlyAccrual {
  month: string;          // '2026-07'
  paymentsCount: number;  // сколько платежей клиентов пришло
  base: Money;            // сумма платежей
  commission: Money;
  status: PayoutStatus;
  paidAt?: Date | null;
}

export function buildAccrual(
  month: string, payments: { amount: Money }[], commissionPct: number, status: PayoutStatus,
): MonthlyAccrual {
  const base = payments.reduce((s, p) => s + p.amount, 0);
  return {
    month, paymentsCount: payments.length, base,
    commission: dealerCommission(base, commissionPct), status,
  };
}

/** Дата ближайшей выплаты: 5-е число следующего месяца.
 *  Из макета: «Приходит на ИП после закрытия месяца, без заявки». */
export function nextPayoutDate(now: Date, payoutDay = 5): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), payoutDay);
  if (now.getDate() >= payoutDay) d.setMonth(d.getMonth() + 1);
  return d;
}

/** Прогноз выплаты: начисленное за закрытый месяц + накопленное за текущий. */
export function payoutForecast(accruals: MonthlyAccrual[], currentMonthCommission: Money): {
  ready: Money; accruing: Money;
} {
  return {
    ready: accruals.filter((a) => a.status !== 'PAID').reduce((s, a) => s + a.commission, 0),
    accruing: currentMonthCommission,
  };
}

export function paidTotal(accruals: MonthlyAccrual[], monthsBack = 6): Money {
  return accruals.filter((a) => a.status === 'PAID').slice(0, monthsBack)
    .reduce((s, a) => s + a.commission, 0);
}

/** Рост комиссии к прошлому месяцу — бейдж «+14,2% к июню». */
export function commissionGrowthPct(current: Money, previous: Money): number | null {
  if (previous <= 0) return null;
  const x = (100 * (current - previous)) / previous;
  return +(Math.sign(x) * Math.round(Math.abs(x) * 10) / 10).toFixed(1);
}

// ═══════════════ ДЕМО-СТЕНДЫ ═══════════════
// Модель r_keeper (у них демо-стенды — отдельный раздел для дилеров),
// но с TTL и учётом конверсии: стенд выдан → клиент подписался?

export interface DemoStand {
  id: string;
  issuedTo: string;        // кому выдан (название заведения)
  issuedAt: Date;
  expiresAt: Date;
  convertedAccountId?: string | null;
}

export function demoStandState(d: DemoStand, now: Date): {
  state: 'converted' | 'active' | 'expiring' | 'expired';
  daysLeft: number; label: string;
} {
  if (d.convertedAccountId) return { state: 'converted', daysLeft: 0, label: 'Клиент подключился 🎉' };
  const daysLeft = Math.ceil((d.expiresAt.getTime() - now.getTime()) / 86_400_000);
  if (daysLeft < 0) return { state: 'expired', daysLeft: 0, label: 'Истёк — не сконвертировался' };
  if (daysLeft <= 3) return { state: 'expiring', daysLeft, label: `Осталось ${daysLeft} дн — пора закрывать сделку` };
  return { state: 'active', daysLeft, label: `Активен ещё ${daysLeft} дн` };
}

export function demoConversionRate(stands: DemoStand[]): number {
  if (!stands.length) return 0;
  return Math.round((100 * stands.filter((s) => s.convertedAccountId).length) / stands.length);
}

// ═══════════════ АККРЕДИТАЦИЯ ═══════════════
// r_keeper требует акцепта договора, NDA и партнёрской политики.
// Мы оставляем то же самое, но одним экраном и без бумажной переписки.

export interface AccreditationStep { id: string; name: string; done: boolean; required: boolean }

export function accreditationSteps(state: Record<string, boolean>): AccreditationStep[] {
  return [
    { id: 'company', name: 'Реквизиты ИП или ТОО (БИН)', done: !!state.company, required: true },
    { id: 'contract', name: 'Партнёрский договор', done: !!state.contract, required: true },
    { id: 'nda', name: 'Соглашение о неразглашении', done: !!state.nda, required: true },
    { id: 'training', name: 'Обучение: демо и типовые возражения', done: !!state.training, required: true },
    { id: 'bank', name: 'Счёт для выплат комиссии', done: !!state.bank, required: true },
  ];
}

export function accreditationProgress(steps: AccreditationStep[]): {
  pct: number; accredited: boolean; nextStep?: AccreditationStep;
} {
  const req = steps.filter((s) => s.required);
  const done = req.filter((s) => s.done);
  return {
    pct: req.length ? Math.round((100 * done.length) / req.length) : 0,
    accredited: done.length === req.length,
    nextStep: req.find((s) => !s.done),
  };
}

// ═══════════════════════════════════════════════════════════════════
// ДОПОЛНЕНИЕ ДИЗАЙН-РЕВИЗИИ
// Анализ r_keeper License выявил две вещи, которых у нас не было:
// СУБДИЛЕРЫ (иерархия партнёров с отдельным правом просмотра) и строгая
// аккредитация по курсам. Макет дал третью: категория дилера
// пересчитывается сама 1-го числа, «заявку писать не нужно».
// ═══════════════════════════════════════════════════════════════════

export class DealerError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ── Категории и ставка ───────────────────────────────────────────

export interface DealerTier {
  id: string; name: string;
  minPayingClients: number;
  minMonthlyBase: Money;
  ratePct: number;
}

/** Лестница категорий. Ставка растёт с объёмом — дилеру выгодно
 *  удерживать клиентов, а не только продавать. */
export const DEALER_TIERS: DealerTier[] = [
  { id: 'start',   name: 'Старт',   minPayingClients: 0,  minMonthlyBase: 0,          ratePct: 12 },
  { id: 'partner', name: 'Партнёр', minPayingClients: 5,  minMonthlyBase: 5_000_000,  ratePct: 15 },
  { id: 'expert',  name: 'Эксперт', minPayingClients: 15, minMonthlyBase: 20_000_000, ratePct: 18 },
  { id: 'master',  name: 'Мастер',  minPayingClients: 40, minMonthlyBase: 60_000_000, ratePct: 22 },
];

/** Категория по факту. Оба условия обязательны — иначе один крупный
 *  клиент вытягивал бы дилера на верхнюю ставку. */
export function currentTier(payingClients: number, monthlyBase: Money): DealerTier {
  let tier = DEALER_TIERS[0];
  for (const t of DEALER_TIERS) {
    if (payingClients >= t.minPayingClients && monthlyBase >= t.minMonthlyBase) tier = t;
  }
  return tier;
}

/** Сколько осталось до следующей категории — показываем в кабинете,
 *  чтобы дилер видел цель, а не гадал. */
export function nextTierProgress(payingClients: number, monthlyBase: Money): null | {
  next: DealerTier; needClients: number; needBase: Money;
} {
  const cur = currentTier(payingClients, monthlyBase);
  const idx = DEALER_TIERS.findIndex((t) => t.id === cur.id);
  const next = DEALER_TIERS[idx + 1];
  if (!next) return null;
  return {
    next,
    needClients: Math.max(0, next.minPayingClients - payingClients),
    needBase: Math.max(0, next.minMonthlyBase - monthlyBase),
  };
}

// ── Защита от присвоения клиентов ────────────────────────────────

export interface Attribution {
  accountId: string;
  dealerId?: string;
  attributedAt?: Date;
  firstPaymentAt?: Date | null;
}

/** Дилер получает комиссию, только если закреплён ДО первой оплаты клиента.
 *  Иначе партнёр «прикрепляется» к уже работающему заведению и получает
 *  деньги ни за что. Правило спорное для дилеров — поэтому явное. */
export function isCommissionable(a: Attribution): boolean {
  if (!a.dealerId || !a.attributedAt) return false;
  if (!a.firstPaymentAt) return true;
  return a.attributedAt.getTime() <= a.firstPaymentAt.getTime();
}

// ── Субдилеры (модель r_keeper) ──────────────────────────────────

export interface DealerNode {
  dealerId: string;
  name: string;
  parentDealerId?: string;
  /** Какая доля комиссии субдилера уходит наверх, %. */
  parentSharePct?: number;
}

/** Делёж комиссии между субдилером и его куратором. */
export function splitWithParent(commission: Money, node: DealerNode): {
  toDealer: Money; toParent: Money;
} {
  if (!node.parentDealerId || !node.parentSharePct) {
    return { toDealer: commission, toParent: 0 };
  }
  const toParent = Math.floor((commission * node.parentSharePct) / 100);
  return { toDealer: commission - toParent, toParent };
}

/** Все субдилеры ветки — для права «Просмотр сущностей Субдилера». */
export function subDealersOf(dealerId: string, all: DealerNode[]): DealerNode[] {
  const out: DealerNode[] = [];
  const walk = (parentId: string) => {
    for (const n of all) {
      if (n.parentDealerId === parentId) { out.push(n); walk(n.dealerId); }
    }
  };
  walk(dealerId);
  return out;
}

// ── Выплаты: минимальная сумма ───────────────────────────────────

/** Мелочь не гоняем переводами — копим до порога. */
export const MIN_PAYOUT: Money = 1_000_000; // 10 000 ₸

export function payableNow(accrued: Money, carriedOver: Money = 0): {
  pay: Money; carryOver: Money; note?: string;
} {
  const total = accrued + carriedOver;
  if (total < MIN_PAYOUT) {
    return { pay: 0, carryOver: total, note: 'Меньше минимума — перенесём на следующий месяц' };
  }
  return { pay: total, carryOver: 0 };
}

// ── Продление демо-стенда ────────────────────────────────────────

export const DEMO_DAYS = 7;
export const DEMO_MAX_EXTENSIONS = 2;

/** Продление кнопкой (из макета), но не бесконечное: стенд должен
 *  конвертироваться в клиента, а не жить вечно. */
export function extendDemo<T extends { expiresAt: Date; extendedTimes?: number }>(
  d: T, now: Date,
): T {
  const times = d.extendedTimes ?? 0;
  if (times >= DEMO_MAX_EXTENSIONS) {
    throw new DealerError('DEMO_LIMIT',
      'Стенд продлевали дважды — заведите клиента или создайте новый стенд');
  }
  const from = d.expiresAt > now ? d.expiresAt : now;
  return {
    ...d,
    expiresAt: new Date(from.getTime() + DEMO_DAYS * 86_400_000),
    extendedTimes: times + 1,
  };
}

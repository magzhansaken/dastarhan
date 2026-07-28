// apps/api/src/platform/vendor.metrics.ts
// МЕТРИКИ ВЕНДОРА — новый модуль (пришёл из дизайн-ревизии супер-админки).
// Анализ: r_keeper License — вендорский портал есть, но считает ЛИЦЕНЗИИ,
// а не бизнес; Paloma — счета в конце месяца; Poster — self-serve без
// публичной аналитики. Ни один из пяти не даёт вендору картину
// «сколько денег под риском прямо сейчас».
//
// Наши метрики: MRR/ARR, отток, активация (доход до первого чека),
// разрез каналов «сами против дилеров» и — главное — ЗДОРОВЬЕ КЛИЕНТОВ
// в деньгах: сколько MRR уйдёт, если сегодня не позвонить.

export type Money = number;

// ═══════════════ ДЕНЬГИ ═══════════════

export interface AccountMetric {
  accountId: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
  mrr: Money;               // ежемесячный платёж
  startedAt: Date;
  firstReceiptAt?: Date | null;  // когда пробили первый чек (активация)
  source: 'self' | 'dealer';
  dealerId?: string;
}

export function mrr(accounts: AccountMetric[]): Money {
  return accounts
    .filter((a) => a.status === 'ACTIVE' || a.status === 'PAST_DUE')
    .reduce((s, a) => s + a.mrr, 0);
}

export function arr(accounts: AccountMetric[]): Money {
  return mrr(accounts) * 12;
}

/** Средний доход с клиента (ARPA). */
export function arpa(accounts: AccountMetric[]): Money {
  const paying = accounts.filter((a) => a.status === 'ACTIVE' || a.status === 'PAST_DUE');
  return paying.length ? Math.round(mrr(accounts) / paying.length) : 0;
}

/** Отток за период: ушедшие / бывшие на начало, в процентах с одним знаком. */
export function churnPct(atStart: number, churned: number): number {
  if (atStart <= 0) return 0;
  return +((100 * churned) / atStart).toFixed(1);
}

/** Разрез новых клиентов по каналу привлечения (экран «12 сами, 6 через дилеров»). */
export function newBySource(accounts: AccountMetric[], from: Date, to: Date) {
  const inPeriod = accounts.filter((a) => a.startedAt >= from && a.startedAt < to);
  return {
    total: inPeriod.length,
    self: inPeriod.filter((a) => a.source === 'self').length,
    dealer: inPeriod.filter((a) => a.source === 'dealer').length,
  };
}

// ═══════════════ АКТИВАЦИЯ ═══════════════
// Открытие дизайн-ревизии: первый пробитый чек — точка невозврата.
// Клиент, дошедший до первого чека, почти всегда платит; не дошедший — почти
// всегда уходит. Поэтому конверсию считаем ДВУМЯ числами.

export function trialConversion(trials: AccountMetric[]): {
  startedTrial: number;
  reachedFirstReceipt: number;
  paid: number;
  toReceiptPct: number;   // дошли до первого чека
  toPaidPct: number;      // дошли до оплаты
  paidAmongActivatedPct: number; // из активированных — сколько заплатили
} {
  const started = trials.length;
  const activated = trials.filter((a) => !!a.firstReceiptAt);
  const paid = trials.filter((a) => a.status === 'ACTIVE' || a.status === 'PAST_DUE');
  const paidAmongActivated = activated.filter((a) => a.status === 'ACTIVE' || a.status === 'PAST_DUE');
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
  return {
    startedTrial: started,
    reachedFirstReceipt: activated.length,
    paid: paid.length,
    toReceiptPct: pct(activated.length, started),
    toPaidPct: pct(paid.length, started),
    paidAmongActivatedPct: pct(paidAmongActivated.length, activated.length),
  };
}

/** Сколько часов от регистрации до первого чека (медиана — устойчивее среднего). */
export function medianTimeToFirstReceiptHours(accounts: AccountMetric[]): number | null {
  const hours = accounts
    .filter((a) => a.firstReceiptAt)
    .map((a) => (a.firstReceiptAt!.getTime() - a.startedAt.getTime()) / 3_600_000)
    .sort((x, y) => x - y);
  if (!hours.length) return null;
  const mid = Math.floor(hours.length / 2);
  return Math.round(hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2);
}

// ═══════════════ ЗДОРОВЬЕ КЛИЕНТОВ ═══════════════
// Экран, которого нет ни у одного конкурента: риск оттока В ДЕНЬГАХ.

export type RiskLevel = 'critical' | 'high' | 'medium' | 'ok';

export interface AccountTelemetry {
  accountId: string;
  name: string;
  mrr: Money;
  lastTerminalSeenAt: Date | null;  // последний выход кассы в сеть
  receiptsLast7d: number;
  revenueThisMonth: Money;
  revenuePrevMonth: Money;
  lastContactAt: Date | null;       // когда мы последний раз общались
  status: AccountMetric['status'];
}

export interface RiskRow {
  accountId: string; name: string; mrr: Money;
  level: RiskLevel;
  reason: string;
  metric: string;
  daysSinceContact: number | null;
}

/** Правила риска. Порядок проверки — от самого тяжёлого симптома.
 *  Пороги подобраны так, чтобы звонить было ещё не поздно. */
export function assessRisk(t: AccountTelemetry, now: Date): RiskRow {
  const hoursSilent = t.lastTerminalSeenAt
    ? (now.getTime() - t.lastTerminalSeenAt.getTime()) / 3_600_000
    : Infinity;
  const daysSinceContact = t.lastContactAt
    ? Math.floor((now.getTime() - t.lastContactAt.getTime()) / 86_400_000)
    : null;
  const base = { accountId: t.accountId, name: t.name, mrr: t.mrr, daysSinceContact };

  // 1. Касса молчит больше суток — возможно, бросили работать
  if (hoursSilent > 24) {
    const label = hoursSilent === Infinity ? 'ни разу не выходила в сеть' : `${Math.floor(hoursSilent)} ч молчит`;
    return { ...base, level: 'critical', reason: 'Касса не в сети', metric: label };
  }
  // 2. Работают, но не продают — не внедрились
  if (t.receiptsLast7d === 0 && (t.status === 'ACTIVE' || t.status === 'TRIAL')) {
    return { ...base, level: 'high', reason: 'Ноль чеков', metric: 'за последнюю неделю' };
  }
  // 3. Выручка просела — проблемы у клиента станут нашими
  if (t.revenuePrevMonth > 0) {
    const dropPct = Math.round((100 * (t.revenueThisMonth - t.revenuePrevMonth)) / t.revenuePrevMonth);
    if (dropPct <= -30) {
      return { ...base, level: 'medium', reason: 'Выручка просела', metric: `${dropPct}% к прошлому месяцу` };
    }
  }
  return { ...base, level: 'ok', reason: '', metric: '' };
}

/** Сводка экрана: сколько MRR под риском и какую долю от всего MRR.
 *  Именно эта цифра превращает «поддержку» в «сохранение денег». */
export function healthSummary(rows: RiskRow[], totalMrr: Money) {
  const atRisk = rows.filter((r) => r.level !== 'ok');
  const mrrAtRisk = atRisk.reduce((s, r) => s + r.mrr, 0);
  return {
    callsToday: atRisk.length,
    mrrAtRisk,
    shareOfMrrPct: totalMrr > 0 ? Math.round((100 * mrrAtRisk) / totalMrr) : 0,
    byLevel: {
      critical: atRisk.filter((r) => r.level === 'critical').length,
      high: atRisk.filter((r) => r.level === 'high').length,
      medium: atRisk.filter((r) => r.level === 'medium').length,
    },
  };
}

/** Порядок обзвона: сначала дорогие и тяжёлые, при равенстве — те,
 *  с кем дольше не общались. */
export function callQueue(rows: RiskRow[]): RiskRow[] {
  const weight: Record<RiskLevel, number> = { critical: 3, high: 2, medium: 1, ok: 0 };
  return rows
    .filter((r) => r.level !== 'ok')
    .sort((a, b) => {
      if (weight[b.level] !== weight[a.level]) return weight[b.level] - weight[a.level];
      if (b.mrr !== a.mrr) return b.mrr - a.mrr;
      return (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0);
    });
}

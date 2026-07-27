// apps/api/src/platform/platform.logic.ts
// Чистая логика платформы продаж.

export type Money = number;

export class PlatformError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ═══════════════ ПОДПИСКА: МАШИНА СОСТОЯНИЙ ═══════════════
// Ключевое отличие от «рубильника» конкурентов: касса офлайн-первая и обязана
// пробивать чеки. Деградация ступенями:
//   ACTIVE → (не оплатил к periodEnd) → PAST_DUE: бэк-офис read-only,
//   КАССА ПОЛНОСТЬЮ РАБОТАЕТ graceDays → SUSPENDED: касса read-only
//   (закрыть открытые смены можно — закон и здравый смысл), продажи стоп.

export type SubStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

export interface Sub {
  status: SubStatus;
  periodEnd: Date;
  trialEnd?: Date;
  graceDays: number;
}

/** Актуальный статус на момент времени (вычисляется, не хранится слепо). */
export function effectiveStatus(s: Sub, now: Date): SubStatus {
  if (s.status === 'CANCELLED') return 'CANCELLED';
  if (s.status === 'TRIAL')
    return s.trialEnd && now > s.trialEnd ? 'SUSPENDED' : 'TRIAL';
  if (now <= s.periodEnd) return 'ACTIVE';
  const graceEnd = new Date(+s.periodEnd + s.graceDays * 24 * 3600 * 1000);
  return now <= graceEnd ? 'PAST_DUE' : 'SUSPENDED';
}

/** Права доступа по статусу: касса/бэк-офис. */
export function accessRights(status: SubStatus): {
  posSell: boolean; posCloseShift: boolean; backoffice: 'full' | 'readonly' | 'billing_only';
} {
  switch (status) {
    case 'TRIAL':
    case 'ACTIVE': return { posSell: true, posCloseShift: true, backoffice: 'full' };
    case 'PAST_DUE': return { posSell: true, posCloseShift: true, backoffice: 'readonly' };
    case 'SUSPENDED': return { posSell: false, posCloseShift: true, backoffice: 'billing_only' };
    case 'CANCELLED': return { posSell: false, posCloseShift: true, backoffice: 'billing_only' };
  }
}

/** Продление: оплата двигает periodEnd на месяц ВПЕРЁД ОТ КОНЦА периода
 *  (не от даты оплаты — оплатил раньше, дни не сгорели). */
export function renew(s: Sub, now: Date, months = 1): Sub {
  const base = now > s.periodEnd ? now : s.periodEnd;
  const end = new Date(base);
  end.setMonth(end.getMonth() + months);
  return { ...s, status: 'ACTIVE', periodEnd: end };
}

// ═══════════════ ЦЕНА И PRORATION ═══════════════

/** Poster-формула: цена = тариф × число точек. */
export function subscriptionPrice(pricePerLocation: Money, locations: number): Money {
  if (locations < 1) throw new PlatformError('BAD_LOCATIONS', 'Минимум 1 точка');
  return pricePerLocation * locations;
}

/** Честный перерасчёт при смене тарифа/точек посреди периода:
 *  доплата = (новая цена − старая) × доля оставшихся дней. Даунгрейд посреди
 *  периода деньги не возвращает (кредит на следующий период). */
export function proration(
  oldMonthly: Money, newMonthly: Money, daysLeft: number, daysInPeriod: number,
): { dueNow: Money; creditNext: Money } {
  if (daysLeft < 0 || daysLeft > daysInPeriod)
    throw new PlatformError('BAD_DAYS', 'Некорректные дни');
  const delta = (newMonthly - oldMonthly) * (daysLeft / daysInPeriod);
  if (delta >= 0) return { dueNow: Math.round(delta), creditNext: 0 };
  return { dueNow: 0, creditNext: Math.round(-delta) };
}

/** Лимиты тарифа: можно ли добавить терминал на точку. */
export function canAddTerminal(currentOnLocation: number, terminalsPerLocation: number): boolean {
  return currentOnLocation < terminalsPerLocation;
}

// ═══════════════ ДИЛЕРЫ: RECURRING-КОМИССИЯ ═══════════════
// r_keeper: дилер зарабатывает на внедрении. Мы: % от подписки КАЖДЫЙ месяц —
// дилер живёт с LTV клиента и заинтересован в его успехе, не в «продал-забыл».

export function dealerCommission(paymentAmount: Money, commissionPct: number): Money {
  if (commissionPct < 0 || commissionPct > 50)
    throw new PlatformError('BAD_PCT', 'Комиссия 0..50%');
  return Math.round(paymentAmount * commissionPct / 100);
}

/** Конверсия демо: демо-аккаунт стал платящим до истечения TTL → засчитан. */
export function demoConverted(demoExpiresAt: Date, firstPaymentAt: Date): boolean {
  return firstPaymentAt <= demoExpiresAt;
}

// ═══════════════ SERVICE DESK: SLA И ЭСКАЛАЦИЯ (r_keeper) ═══════════════

export const SLA_HOURS: Record<string, number> = {
  low: 48, normal: 24, high: 8, critical: 2,
};

export function ticketDueAt(createdAt: Date, priority: string): Date {
  const h = SLA_HOURS[priority] ?? SLA_HOURS.normal;
  return new Date(+createdAt + h * 3600 * 1000);
}

/** Авто-эскалация: просрочен SLA на 1-й линии (дилер) и не решён →
 *  уходит вендору; причина фиксируется (r_keeper: «только по причинам»). */
export function shouldAutoEscalate(
  t: { level: 'DEALER' | 'VENDOR'; status: string; dueAt: Date }, now: Date,
): boolean {
  return t.level === 'DEALER'
    && (t.status === 'OPEN' || t.status === 'IN_PROGRESS')
    && now > t.dueAt;
}

// ═══════════════ TRIAL ═══════════════

export function startTrial(now: Date, days = 14): Sub {
  return {
    status: 'TRIAL',
    trialEnd: new Date(+now + days * 24 * 3600 * 1000),
    periodEnd: new Date(+now + days * 24 * 3600 * 1000),
    graceDays: 7,
  };
}

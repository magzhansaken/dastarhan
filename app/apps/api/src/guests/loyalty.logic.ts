// apps/api/src/guests/loyalty.logic.ts
// Чистая логика лояльности. Ledger-принцип как на складе: балансы = Σ движений.

export type Money = number; // тиыны

export class LoyaltyError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ═══════════════ ТЕЛЕФОН КЗ ═══════════════
// Телефон — главный ID клиента в КЗ. Нормализация: 8707..., +7707..., 707...
// → единый формат +7707XXXXXXX. Ошибка формата ловится на входе.
export function normalizePhoneKz(raw: string): string {
  const d = raw.replace(/\D/g, '');
  let n = d;
  if (n.length === 11 && (n.startsWith('8') || n.startsWith('7'))) n = n.slice(1);
  if (n.length !== 10) throw new LoyaltyError('BAD_PHONE', `Неверный номер: ${raw}`);
  return `+7${n}`;
}

// ═══════════════ БОНУСЫ ═══════════════

export interface BonusProgramDef {
  accrualPct: number;   // базовый % начисления
  maxPayPct: number;    // лимит оплаты бонусами, % чека
  expireDays?: number;
}

/** Начисление: % от суммы ПОСЛЕ скидок и БЕЗ части, оплаченной бонусами
 *  (иначе бонусы плодят бонусы — грабля, которую iikoCard закрывает). */
export function bonusAccrual(
  paidRealMoney: Money,          // оплачено «живыми» деньгами (без бонусов)
  program: BonusProgramDef,
  groupBonusPct?: number,        // % группы клиента перекрывает базовый
): Money {
  const pct = groupBonusPct ?? program.accrualPct;
  return Math.round(paidRealMoney * pct / 100);
}

/** Сколько бонусов МОЖНО потратить на чек: min(баланс, лимит % чека). */
export function bonusPayable(orderTotal: Money, balance: Money, program: BonusProgramDef): Money {
  const cap = Math.floor(orderTotal * program.maxPayPct / 100);
  return Math.max(0, Math.min(balance, cap));
}

/** Сгорание: FIFO по начислениям с истёкшим сроком. Возвращает сумму к сгоранию. */
export function bonusToExpire(
  accruals: { amount: Money; expiresAt?: Date | null; spent: Money }[],
  now: Date,
): Money {
  let total = 0;
  for (const a of accruals) {
    if (a.expiresAt && a.expiresAt <= now) total += Math.max(0, a.amount - a.spent);
  }
  return total;
}

// ═══════════════ КОШЕЛЁК: ДЕПОЗИТ + ДОЛГ (Paloma, углублено) ═══════════════

export interface Wallet { balance: Money; creditLimit: Money }

/** Оплата с кошелька: баланс может уйти в минус ДО −creditLimit
 *  («запиши на меня» — долговая система Paloma с нашим лимитом). */
export function walletPay(w: Wallet, amount: Money): Wallet {
  if (amount <= 0) throw new LoyaltyError('BAD_AMOUNT', 'Сумма должна быть > 0');
  const next = w.balance - amount;
  if (next < -w.creditLimit)
    throw new LoyaltyError('CREDIT_EXCEEDED',
      `Долг превысит лимит: доступно ${w.balance + w.creditLimit}`);
  return { ...w, balance: next };
}

export function walletTopup(w: Wallet, amount: Money): Wallet {
  if (amount <= 0) throw new LoyaltyError('BAD_AMOUNT', 'Сумма должна быть > 0');
  return { ...w, balance: w.balance + amount };
}

export function walletDebt(w: Wallet): Money {
  return Math.max(0, -w.balance);
}

// ═══════════════ СКИДКИ ═══════════════

export interface DiscountDef {
  id: string; pct: number; categoryId?: string | null;
  daysMask: number; fromMin?: number | null; toMin?: number | null;
}

/** Активна ли скидка в момент времени (happy hours: дни + окно минут). */
export function discountActiveAt(d: DiscountDef, at: Date): boolean {
  const dow = (at.getDay() + 6) % 7;           // Пн=0..Вс=6
  if (!(d.daysMask & (1 << dow))) return false;
  if (d.fromMin == null || d.toMin == null) return true;
  const m = at.getHours() * 60 + at.getMinutes();
  return d.fromMin <= d.toMin
    ? m >= d.fromMin && m < d.toMin
    : m >= d.fromMin || m < d.toMin;           // окно через полночь (бар!)
}

/** Правило конкурентов (и наше): скидки НЕ суммируются — применяется ЛУЧШАЯ
 *  для гостя из активных (авто группы + временные). Ручная — поверх, по праву. */
export function bestDiscount(cands: { id: string; pct: number }[]): { id: string; pct: number } | null {
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.pct > a.pct ? b : a));
}

export function applyDiscount(total: Money, pct: number): { discount: Money; final: Money } {
  const discount = Math.round(total * pct / 100);
  return { discount, final: total - discount };
}

// ═══════════════ АКЦИИ (палитра QuickResto offers) ═══════════════

/** N+1: каждый N-й одинаковый товар бесплатно (3-й кофе в подарок).
 *  gifts = floor(qty / n); скидка = gifts × цена. */
export function nPlusGift(qty: number, n: number, unitPrice: Money): { gifts: number; discount: Money } {
  if (n < 2) throw new LoyaltyError('BAD_N', 'N должно быть ≥ 2');
  const gifts = Math.floor(qty / n);
  return { gifts, discount: gifts * unitPrice };
}

/** Подарок от суммы: заказ ≥ minSum → подарочный товар добавляется за 0. */
export function giftFromSum(orderTotal: Money, minSum: Money): boolean {
  return orderTotal >= minSum;
}

/** Промокод: проверка срока и лимита использований (расходуемый — QR). */
export interface PromoCodeDef {
  code: string; pct?: number; amount?: Money;
  maxUses?: number; usedCount: number;
  validFrom?: Date | null; validTo?: Date | null;
}

export function checkPromoCode(p: PromoCodeDef, input: string, now: Date): void {
  if (p.code.toLowerCase() !== input.trim().toLowerCase())
    throw new LoyaltyError('PROMO_NOT_FOUND', 'Промокод не найден');
  if (p.validFrom && now < p.validFrom) throw new LoyaltyError('PROMO_NOT_STARTED', 'Промокод ещё не действует');
  if (p.validTo && now > p.validTo) throw new LoyaltyError('PROMO_EXPIRED', 'Промокод истёк');
  if (p.maxUses != null && p.usedCount >= p.maxUses)
    throw new LoyaltyError('PROMO_USED_UP', 'Промокод исчерпан');
}

export function promoDiscount(p: PromoCodeDef, orderTotal: Money): Money {
  if (p.amount != null) return Math.min(p.amount, orderTotal);
  if (p.pct != null) return Math.round(orderTotal * p.pct / 100);
  return 0;
}

/** Абонемент (кофе-абонемент QR): N использований товара. */
export interface SubscriptionState { remaining: number }
export function useSubscription(s: SubscriptionState): SubscriptionState {
  if (s.remaining <= 0) throw new LoyaltyError('SUB_EMPTY', 'Абонемент исчерпан');
  return { remaining: s.remaining - 1 };
}

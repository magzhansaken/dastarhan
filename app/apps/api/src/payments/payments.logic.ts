// apps/api/src/payments/payments.logic.ts
// Чистая логика оплат и фискализации. Тестируется изолированно.

export type Money = number; // тиыны

export interface Pay {
  paymentId: string;
  kind: 'CASH' | 'CARD' | 'KASPI_QR' | 'BONUS' | 'TRANSFER';
  amount: Money;          // к зачёту
  tendered?: Money;       // CASH: получено от гостя
  status: 'PENDING' | 'CAPTURED' | 'FAILED' | 'VOIDED' | 'REFUNDED';
}

export class PayError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ── Смешанная оплата (QuickResto: «несколькими типами», отмена частичной) ──
export function paidTotal(pays: Pay[]): Money {
  return pays.filter((p) => p.status === 'CAPTURED').reduce((s, p) => s + p.amount, 0);
}

export function remainingDue(orderTotal: Money, pays: Pay[]): Money {
  return Math.max(0, orderTotal - paidTotal(pays));
}

/** Валидация добавляемого платежа. Наличные: обязателен tendered ≥ amount;
 *  переплата разрешена ТОЛЬКО наличными (сдача) — карта ровно в остаток. */
export function validateNewPayment(orderTotal: Money, pays: Pay[], p: Pay): void {
  const due = remainingDue(orderTotal, pays);
  if (due <= 0) throw new PayError('ALREADY_PAID', 'Заказ уже оплачен');
  if (p.amount <= 0) throw new PayError('BAD_AMOUNT', 'Сумма должна быть > 0');
  if (p.kind === 'CASH') {
    if (p.amount > due) throw new PayError('OVER_DUE', 'К зачёту больше остатка');
    if ((p.tendered ?? 0) < p.amount)
      throw new PayError('TENDERED_LOW', 'Получено меньше суммы к зачёту');
  } else {
    if (p.amount > due)
      throw new PayError('OVER_DUE', 'Безнал не может превышать остаток (сдачи нет)');
  }
}

export function change(p: Pay): Money {
  return p.kind === 'CASH' ? Math.max(0, (p.tendered ?? p.amount) - p.amount) : 0;
}

/** Заказ можно закрыть, когда остаток 0 (все CAPTURED). */
export function canCloseOrder(orderTotal: Money, pays: Pay[]): boolean {
  return remainingDue(orderTotal, pays) === 0;
}

/** Отмена частичной оплаты до закрытия (QuickResto): CAPTURED → VOIDED.
 *  CASH — вернуть из ящика; CARD — отмена на терминале (void). */
export function voidPayment(pays: Pay[], paymentId: string): Pay[] {
  const p = pays.find((x) => x.paymentId === paymentId);
  if (!p) throw new PayError('NOT_FOUND', 'Платёж не найден');
  if (p.status !== 'CAPTURED') throw new PayError('NOT_CAPTURED', 'Отменить можно только принятый платёж');
  return pays.map((x) => (x.paymentId === paymentId ? { ...x, status: 'VOIDED' as const } : x));
}

// ── Возвраты по закрытому чеку (частичные, по платежам) ────────
export function validateRefund(p: Pay, alreadyRefunded: Money, amount: Money, reason: string): void {
  if (!reason?.trim()) throw new PayError('REASON_REQUIRED', 'Причина возврата обязательна');
  if (p.status !== 'CAPTURED' && p.status !== 'REFUNDED')
    throw new PayError('NOT_REFUNDABLE', 'Платёж нельзя вернуть');
  if (amount <= 0 || amount > p.amount - alreadyRefunded)
    throw new PayError('BAD_AMOUNT', 'Сумма возврата превышает остаток платежа');
}

// ═══════════════ ФИСКАЛЬНЫЙ КОНТУР ═══════════════
// Интерфейс драйвера — паттерн Poster dev device/fiscal (sell/refund,
// success/errorCode) + мультипровайдерность Paloma.

export interface FiscalItem {
  name: string; qty: number; price: Money; // цена за единицу с учётом модификаторов
  vatRate: number; // 16 | 0
}
export interface FiscalRequest {
  op: 'SELL' | 'REFUND';
  items: FiscalItem[];
  payments: { kind: Pay['kind']; amount: Money }[];
  total: Money;
}
export interface FiscalResult {
  success: boolean;
  fiscalNumber?: string;
  ofdUrl?: string;
  errorCode?: string;
  errorText?: string;
  retriable?: boolean; // сеть/временная ошибка → ретрай; логическая → нет
}
export interface FiscalDriver {
  type: string;
  send(req: FiscalRequest): Promise<FiscalResult>;
}

/** Валидация чека перед отправкой: суммы позиций = сумме платежей = total.
 *  Ловим расхождения ДО провайдера (у конкурентов частая причина ошибок ОФД). */
export function validateFiscalRequest(req: FiscalRequest): void {
  const itemsSum = req.items.reduce((s, i) => s + Math.round(i.price * i.qty), 0);
  const paysSum = req.payments.reduce((s, p) => s + p.amount, 0);
  if (itemsSum !== req.total)
    throw new PayError('FISCAL_ITEMS_MISMATCH', `Позиции ${itemsSum} ≠ итог ${req.total}`);
  if (paysSum !== req.total)
    throw new PayError('FISCAL_PAYS_MISMATCH', `Оплаты ${paysSum} ≠ итог ${req.total}`);
}

// ── Очередь с ретраями (офлайн-фискализация) ────────────────────
export interface QueueItem {
  id: string;
  attempts: number;
  status: 'QUEUED' | 'SENT' | 'ERROR' | 'SKIPPED';
  nextTryAt: number; // epoch ms
}

/** Экспоненциальный backoff: 5с → 30с → 2м → 10м → 30м → далее каждый час.
 *  Продажа никогда не блокируется фискализацией — чек догоняет. */
export function nextRetryDelayMs(attempts: number): number {
  const steps = [5_000, 30_000, 120_000, 600_000, 1_800_000];
  return steps[Math.min(attempts, steps.length - 1)] ?? 3_600_000;
}

export function planRetry(item: QueueItem, now: number, result: FiscalResult): QueueItem {
  if (result.success) return { ...item, status: 'SENT' };
  if (result.retriable === false) return { ...item, status: 'ERROR' }; // логическая — руками
  const attempts = item.attempts + 1;
  return { ...item, attempts, status: 'QUEUED', nextTryAt: now + nextRetryDelayMs(attempts) };
}

export function dueForRetry(items: QueueItem[], now: number): QueueItem[] {
  return items.filter((i) => i.status === 'QUEUED' && i.nextTryAt <= now);
}

// ═══════════════ KASPI-ТЕРМИНАЛ (машина состояний) ═══════════════
// Paloma: сумма автоматически летит на терминал; кассир не набирает руками.
// Конфликт: если у клиента Kaspi Kassa — интеграция терминала недоступна
// (задокументировано у Paloma) → покажем это в настройках.

export type TerminalPhase = 'IDLE' | 'WAITING_CARD' | 'APPROVED' | 'DECLINED' | 'TIMEOUT' | 'CANCELLED';

export interface TerminalSession {
  phase: TerminalPhase;
  amount: Money;
  rrn?: string; // референс транзакции банка
}

export function terminalStart(amount: Money): TerminalSession {
  if (amount <= 0) throw new PayError('BAD_AMOUNT', 'Сумма терминала должна быть > 0');
  return { phase: 'WAITING_CARD', amount };
}
export function terminalResolve(s: TerminalSession, ev: { type: 'approved'; rrn: string } | { type: 'declined' } | { type: 'timeout' } | { type: 'cancel' }): TerminalSession {
  if (s.phase !== 'WAITING_CARD') throw new PayError('BAD_PHASE', 'Терминал не ждёт карту');
  switch (ev.type) {
    case 'approved': return { ...s, phase: 'APPROVED', rrn: ev.rrn };
    case 'declined': return { ...s, phase: 'DECLINED' };
    case 'timeout': return { ...s, phase: 'TIMEOUT' };
    case 'cancel': return { ...s, phase: 'CANCELLED' };
  }
}

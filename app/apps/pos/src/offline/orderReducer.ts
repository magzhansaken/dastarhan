// apps/pos/src/offline/orderReducer.ts
// СЕРДЦЕ ОФЛАЙН-КАССЫ: заказ = свёртка событий (event sourcing).
// Одна и та же чистая функция reduce() исполняется:
//   1) на кассе — мгновенно, без сети (события в SQLite);
//   2) на сервере — при применении EventLog (Этап 0);
// поэтому офлайн-состояние и облако сходятся детерминированно.
// Глубина операций — QuickResto (переносы, курсы, частичная кухня,
// удаление с причиной) + Poster (3 режима, стоп-лист) + смена expected/actual.

export type Money = number; // тиыны

export interface OrderItemState {
  itemId: string;
  productId: string;
  name: string;
  guestNo: number;
  qty: number;
  unitPrice: Money;
  modifiersPrice: Money;
  modifiers: { optionId: string; name: string; priceDelta: Money; componentId?: string; qty?: number }[];
  course: number;
  comment?: string;
  kitchenStatus: 'NEW' | 'SENT' | 'COOKED' | 'SERVED';
  isRemoved: boolean;
  removedReason?: string;
}

export interface OrderState {
  orderId: string;
  number: number;
  mode: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  tableId?: string;
  waiterId?: string;
  guestsCount: number;
  items: OrderItemState[];
}

export type OrderEvent =
  | { type: 'order.opened'; orderId: string; number: number; mode: OrderState['mode']; tableId?: string; waiterId?: string; guestsCount?: number }
  | { type: 'order.item.added'; orderId: string; itemId: string; productId: string; name: string; guestNo: number; qty: number; unitPrice: Money; modifiers: OrderItemState['modifiers']; course?: number }
  | { type: 'order.item.qty_changed'; orderId: string; itemId: string; qty: number }
  | { type: 'order.item.removed'; orderId: string; itemId: string; reason: string; byUserId: string }
  | { type: 'order.item.comment'; orderId: string; itemId: string; comment: string }
  | { type: 'order.item.moved_to_guest'; orderId: string; itemId: string; guestNo: number }        // QR: блюдо→гость
  | { type: 'order.moved_to_table'; orderId: string; tableId: string }                              // QR: заказ→стол
  | { type: 'order.waiter_changed'; orderId: string; waiterId: string }                             // QR: заказ→официант
  | { type: 'order.kitchen.sent'; orderId: string; itemIds: string[] }                              // QR: частичная отправка
  | { type: 'order.closed'; orderId: string }
  | { type: 'order.cancelled'; orderId: string; reason: string; byUserId: string };

export class DomainError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

export function reduceOrder(state: OrderState | null, ev: OrderEvent): OrderState {
  if (ev.type === 'order.opened') {
    if (state) throw new DomainError('ALREADY_OPEN', 'Заказ уже открыт');
    return {
      orderId: ev.orderId, number: ev.number, mode: ev.mode,
      status: 'OPEN', tableId: ev.tableId, waiterId: ev.waiterId,
      guestsCount: ev.guestsCount ?? 1, items: [],
    };
  }
  if (!state) throw new DomainError('NOT_FOUND', 'Заказ не найден');
  if (state.status !== 'OPEN' && ev.type !== 'order.closed')
    throw new DomainError('NOT_OPEN', 'Заказ закрыт — операции недоступны');

  const find = (id: string) => {
    const it = state.items.find((i) => i.itemId === id && !i.isRemoved);
    if (!it) throw new DomainError('ITEM_NOT_FOUND', 'Позиция не найдена');
    return it;
  };
  const patchItem = (id: string, patch: Partial<OrderItemState>): OrderState => ({
    ...state,
    items: state.items.map((i) => (i.itemId === id ? { ...i, ...patch } : i)),
  });

  switch (ev.type) {
    case 'order.item.added': {
      const modifiersPrice = ev.modifiers.reduce((s, m) => s + m.priceDelta, 0);
      return {
        ...state,
        items: [...state.items, {
          itemId: ev.itemId, productId: ev.productId, name: ev.name,
          guestNo: ev.guestNo, qty: ev.qty, unitPrice: ev.unitPrice,
          modifiersPrice, modifiers: ev.modifiers,
          course: ev.course ?? 1, kitchenStatus: 'NEW', isRemoved: false,
        }],
      };
    }
    case 'order.item.qty_changed': {
      const it = find(ev.itemId);
      if (it.kitchenStatus !== 'NEW')
        throw new DomainError('ALREADY_SENT', 'Позиция уже на кухне — количество не изменить, удалите с причиной');
      if (ev.qty <= 0) throw new DomainError('BAD_QTY', 'Количество должно быть > 0');
      return patchItem(ev.itemId, { qty: ev.qty });
    }
    case 'order.item.removed': {
      find(ev.itemId); // проверка существования
      if (!ev.reason?.trim())
        throw new DomainError('REASON_REQUIRED', 'Укажите причину удаления'); // след для отчёта злоупотреблений
      return patchItem(ev.itemId, { isRemoved: true, removedReason: ev.reason });
    }
    case 'order.item.comment':
      find(ev.itemId);
      return patchItem(ev.itemId, { comment: ev.comment });
    case 'order.item.moved_to_guest': {
      if (ev.guestNo < 0 || ev.guestNo > state.guestsCount)
        throw new DomainError('BAD_GUEST', `Гость №${ev.guestNo} вне диапазона`);
      find(ev.itemId);
      return patchItem(ev.itemId, { guestNo: ev.guestNo });
    }
    case 'order.moved_to_table':
      if (state.mode !== 'DINE_IN')
        throw new DomainError('NO_TABLE_MODE', 'Стол доступен только в зале');
      return { ...state, tableId: ev.tableId };
    case 'order.waiter_changed':
      return { ...state, waiterId: ev.waiterId };
    case 'order.kitchen.sent': {
      const ids = new Set(ev.itemIds);
      return {
        ...state,
        items: state.items.map((i) =>
          ids.has(i.itemId) && !i.isRemoved && i.kitchenStatus === 'NEW'
            ? { ...i, kitchenStatus: 'SENT' } : i),
      };
    }
    case 'order.closed':
      if (state.status !== 'OPEN') throw new DomainError('NOT_OPEN', 'Уже закрыт');
      return { ...state, status: 'CLOSED' };
    case 'order.cancelled':
      if (!ev.reason?.trim()) throw new DomainError('REASON_REQUIRED', 'Причина обязательна');
      return { ...state, status: 'CANCELLED' };
  }
}

// ── Итоги заказа ─────────────────────────────────────────────────
export function orderTotals(state: OrderState) {
  const live = state.items.filter((i) => !i.isRemoved);
  const subtotal = live.reduce((s, i) => s + (i.unitPrice + i.modifiersPrice) * i.qty, 0);
  return { subtotal, itemsCount: live.length };
}

// Счёт по гостям — фундамент «разбить счёт» (Paloma razbit-schet / QR по гостям)
export function totalsByGuest(state: OrderState): Map<number, Money> {
  const m = new Map<number, Money>();
  for (const i of state.items) {
    if (i.isRemoved) continue;
    m.set(i.guestNo, (m.get(i.guestNo) ?? 0) + (i.unitPrice + i.modifiersPrice) * i.qty);
  }
  return m;
}

// ── Кассовая смена: книжный баланс (Poster expected/actual) ──────
export interface ShiftFinance {
  openingCash: Money;
  cashSales: Money;     // наличные продажи закрытых заказов
  cashRefunds: Money;
  cashIn: Money;
  cashOut: Money;       // включая инкассацию
}

export function expectedCash(f: ShiftFinance): Money {
  return f.openingCash + f.cashSales + f.cashIn - f.cashOut - f.cashRefunds;
}

export function shiftDiscrepancy(f: ShiftFinance, actualCash: Money) {
  const expected = expectedCash(f);
  return { expected, actual: actualCash, discrepancy: actualCash - expected };
}

// ── Стоп-лист с остатком (Poster: «осталось N порций») ──────────
export interface StopEntry { productId: string; remainingQty: number | null }

/** Проверка перед добавлением в заказ; null = полный стоп. */
export function checkStopList(stop: Map<string, number | null>, productId: string, qty: number):
  { ok: true } | { ok: false; reason: 'STOPPED' | 'NOT_ENOUGH'; remaining?: number } {
  if (!stop.has(productId)) return { ok: true };
  const rem = stop.get(productId)!;
  if (rem === null) return { ok: false, reason: 'STOPPED' };
  if (qty > rem) return { ok: false, reason: 'NOT_ENOUGH', remaining: rem };
  return { ok: true };
}

/** Декремент остатка при продаже; 0 → полный стоп автоматически. */
export function consumeStop(stop: Map<string, number | null>, productId: string, qty: number) {
  if (!stop.has(productId)) return;
  const rem = stop.get(productId);
  if (rem === null) return;
  stop.set(productId, Math.max(0, rem - qty));
  if (stop.get(productId) === 0) stop.set(productId, null);
}

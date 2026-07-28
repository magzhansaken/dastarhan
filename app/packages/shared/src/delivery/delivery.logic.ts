// packages/shared/src/delivery/delivery.logic.ts
// Чистая логика доставки. Образец контура — r_keeper Delivery (лучший из 5).

export type Money = number;

export class DeliveryError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ═══════════════ МАШИНА СТАТУСОВ (r_keeper-модель) ═══════════════
// Ядро обязательное, порядок строгий (r_keeper: «статусы не могут быть
// перемешаны»); имена настраиваемы в UI, коды — нет.
export const DELIVERY_FLOW = [
  'NEW',        // принят (телефон/бот/агрегатор)
  'CONFIRMED',  // подтверждён оператором
  'COOKING',    // на кухне
  'READY',      // собран, ждёт курьера
  'DISPATCHED', // у курьера (в рейсе)
  'DELIVERED',  // вручён
] as const;
export type DeliveryStatus = typeof DELIVERY_FLOW[number] | 'CANCELLED' | 'RETURNED';

/** Допустимые переходы: только вперёд по цепочке на 1 шаг; отмена — из любого
 *  до DISPATCHED; возврат — только из DISPATCHED/DELIVERED (не довезли). */
export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  if (to === 'CANCELLED')
    return from !== 'DELIVERED' && from !== 'CANCELLED' && from !== 'RETURNED' && from !== 'DISPATCHED';
  if (to === 'RETURNED') return from === 'DISPATCHED' || from === 'DELIVERED';
  const fi = DELIVERY_FLOW.indexOf(from as any);
  const ti = DELIVERY_FLOW.indexOf(to as any);
  return fi >= 0 && ti === fi + 1;
}

export function transition(from: DeliveryStatus, to: DeliveryStatus): DeliveryStatus {
  if (!canTransition(from, to))
    throw new DeliveryError('BAD_TRANSITION', `Нельзя ${from} → ${to}`);
  return to;
}

/** Просрочка обещанного времени (метрика тепловой карты r_keeper). */
export function isOverdue(promisedAt: Date, now: Date, status: DeliveryStatus): boolean {
  return status !== 'DELIVERED' && status !== 'CANCELLED' && status !== 'RETURNED'
    && now > promisedAt;
}

// ═══════════════ ЗОНЫ: ПОЛИГОНЫ (r_keeper) ═══════════════

export interface Zone {
  id: string; polygon: [number, number][]; // [lat,lng][]
  minOrder: Money; deliveryFee: Money; freeFrom: Money | null;
  etaMinutes: number; priority: number;
}

/** Точка в полигоне — ray casting (стандарт геометрии зон). */
export function pointInPolygon(pt: [number, number], poly: [number, number][]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Зоны пересекаются (r_keeper) → из подходящих выбираем ЛУЧШУЮ ДЛЯ КЛИЕНТА:
 *  1) где min-заказ выполнен; 2) дешевле доставка (учитывая freeFrom);
 *  3) при равенстве — быстрее ETA; 4) затем приоритет. */
export function resolveZone(pt: [number, number], orderTotal: Money, zones: Zone[]):
  { zone: Zone; fee: Money } | { error: 'OUT_OF_ZONE' } | { error: 'MIN_ORDER'; needed: Money } {
  const hit = zones.filter((z) => pointInPolygon(pt, z.polygon));
  if (!hit.length) return { error: 'OUT_OF_ZONE' };
  const ok = hit.filter((z) => orderTotal >= z.minOrder);
  if (!ok.length) {
    const needed = Math.min(...hit.map((z) => z.minOrder));
    return { error: 'MIN_ORDER', needed };
  }
  const feeOf = (z: Zone) => (z.freeFrom != null && orderTotal >= z.freeFrom ? 0 : z.deliveryFee);
  ok.sort((a, b) =>
    feeOf(a) - feeOf(b) || a.etaMinutes - b.etaMinutes || b.priority - a.priority);
  const zone = ok[0];
  return { zone, fee: feeOf(zone) };
}

// ═══════════════ КУРЬЕРЫ: РЕЙС И РАСЧЁТ (r_keeper) ═══════════════

export interface Trip {
  courierId: string;
  orders: { orderId: string; status: DeliveryStatus; cashDue: Money }[];
  cashCollected: Money;
  cashReturned: Money;
  closed: boolean;
}

export function newTrip(courierId: string): Trip {
  return { courierId, orders: [], cashCollected: 0, cashReturned: 0, closed: false };
}

/** В рейс — только заказы READY; статус → DISPATCHED. */
export function assignToTrip(trip: Trip, orderId: string, status: DeliveryStatus, cashDue: Money): Trip {
  if (trip.closed) throw new DeliveryError('TRIP_CLOSED', 'Рейс закрыт');
  if (status !== 'READY') throw new DeliveryError('NOT_READY', 'Заказ не собран');
  return {
    ...trip,
    orders: [...trip.orders, { orderId, status: 'DISPATCHED', cashDue }],
  };
}

/** Вручение: наличный заказ пополняет собранное курьером. */
export function markDelivered(trip: Trip, orderId: string): Trip {
  const o = trip.orders.find((x) => x.orderId === orderId);
  if (!o) throw new DeliveryError('NOT_IN_TRIP', 'Заказ не в этом рейсе');
  if (o.status !== 'DISPATCHED') throw new DeliveryError('BAD_STATUS', 'Заказ не в пути');
  return {
    ...trip,
    orders: trip.orders.map((x) => x.orderId === orderId ? { ...x, status: 'DELIVERED' as DeliveryStatus } : x),
    cashCollected: trip.cashCollected + o.cashDue,
  };
}

/** Долг курьера = собрал − сдал (r_keeper «расчёт с курьерами»). */
export function courierDebt(trip: Trip): Money {
  return trip.cashCollected - trip.cashReturned;
}

/** Сдача наличных в кассу; закрыть рейс можно только при нулевом долге
 *  и без заказов в пути. */
export function returnCash(trip: Trip, amount: Money): Trip {
  if (amount <= 0) throw new DeliveryError('BAD_AMOUNT', 'Сумма должна быть > 0');
  if (amount > courierDebt(trip))
    throw new DeliveryError('OVER_DEBT', 'Сдаёт больше, чем должен');
  return { ...trip, cashReturned: trip.cashReturned + amount };
}

export function closeTrip(trip: Trip): Trip {
  const inFlight = trip.orders.filter((o) => o.status === 'DISPATCHED');
  if (inFlight.length)
    throw new DeliveryError('ORDERS_IN_FLIGHT', `В пути ещё ${inFlight.length} заказ(а)`);
  if (courierDebt(trip) !== 0)
    throw new DeliveryError('DEBT_NOT_ZERO', `Курьер должен ${courierDebt(trip)}`);
  return { ...trip, closed: true };
}

// ═══════════════ ВЕБХУКИ (r_keeper «подписка на статусы») ═══════════════

export function shouldNotify(subscribedStatuses: string[], status: DeliveryStatus): boolean {
  return subscribedStatuses.length === 0 || subscribedStatuses.includes(status);
}

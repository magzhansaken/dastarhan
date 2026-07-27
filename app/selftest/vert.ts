// apps/api/src/verticals/verticals.logic.ts
// Чистая логика трёх вертикалей. Глубже единственного образца (Paloma).

export type Money = number;

export class VerticalError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ═══════════════ МАГАЗИН: ВЕСОВЫЕ ШТРИХКОДЫ ═══════════════
// Стандарт весов СНГ/КЗ: EAN-13 с префиксом 22/23:
//   [2 префикс][5 код товара][5 вес в граммах][1 чек-цифра]
// Пример: 2200123005507 → товар 00123, вес 550 г.

export function ean13CheckDigit(digits12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (+digits12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function validateEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === +code[12];
}

export interface WeightBarcode { plu: string; weightGrams: number }

/** Разбор весового кода. null = обычный штрихкод (искать по Barcode как есть). */
export function parseWeightBarcode(code: string): WeightBarcode | null {
  if (!validateEan13(code)) return null;
  const prefix = code.slice(0, 2);
  if (prefix !== '22' && prefix !== '23') return null;
  return { plu: code.slice(2, 7), weightGrams: +code.slice(7, 12) };
}

/** Цена весовой позиции: вес × цена за кг (pricePerKg в тиынах). */
export function weightPrice(weightGrams: number, pricePerKg: Money): Money {
  return Math.round((weightGrams / 1000) * pricePerKg);
}

/** Генерация весового штрихкода для этикетки (печать на весах/принтере). */
export function makeWeightBarcode(plu: string, weightGrams: number, prefix = '22'): string {
  if (!/^\d{1,5}$/.test(plu)) throw new VerticalError('BAD_PLU', 'PLU до 5 цифр');
  if (weightGrams < 0 || weightGrams > 99999) throw new VerticalError('BAD_WEIGHT', 'Вес 0..99999 г');
  const body = prefix + plu.padStart(5, '0') + String(weightGrams).padStart(5, '0');
  return body + ean13CheckDigit(body);
}

// ═══════════════ ПОВРЕМЕНКА: ТАРИФНЫЕ ОКНА ═══════════════

export interface Tariff { daysMask: number; fromMin: number; toMin: number; pricePerHour: Money }

/** Тариф, действующий в конкретную минуту недели (dow 0=Пн). Окна могут
 *  идти через полночь (вечер 18:00–02:00). При пересечении — дороже
 *  (вечерний приоритетнее дневного, бизнес-правило клубов). */
export function tariffAt(tariffs: Tariff[], dow: number, minOfDay: number): Tariff | null {
  const hit = tariffs.filter((t) => {
    const inWindow = t.fromMin <= t.toMin
      ? minOfDay >= t.fromMin && minOfDay < t.toMin
      : minOfDay >= t.fromMin || minOfDay < t.toMin;
    // окно через полночь принадлежит дню СТАРТА окна
    const effDow = (t.fromMin <= t.toMin || minOfDay >= t.fromMin) ? dow : (dow + 6) % 7;
    return inWindow && (t.daysMask & (1 << effDow));
  });
  if (!hit.length) return null;
  return hit.reduce((a, b) => (b.pricePerHour > a.pricePerHour ? b : a));
}

export interface Pause { from: Date; to: Date }

/** Биллинг сессии ПОМИНУТНО с пересечением тарифных окон:
 *  сессия 17:00–19:00 при дневном до 18:00 и вечернем после = час по
 *  дневному + час по вечернему. Паузы вычитаются (гость не платит за
 *  перерыв — глубина, которой нет у Paloma). */
export function billSession(
  start: Date, end: Date, tariffs: Tariff[], pauses: Pause[] = [],
  minChargeMin = 30, stepMin = 5,
): { billedMinutes: number; amount: Money; breakdown: { pricePerHour: Money; minutes: number }[] } {
  if (end <= start) throw new VerticalError('BAD_RANGE', 'Конец раньше начала');
  const inPause = (t: Date) => pauses.some((p) => t >= p.from && t < p.to);
  const perTariff = new Map<Money, number>();
  let payable = 0;
  const cur = new Date(start);
  while (cur < end) {
    if (!inPause(cur)) {
      const dow = (cur.getDay() + 6) % 7;
      const mod = cur.getHours() * 60 + cur.getMinutes();
      const t = tariffAt(tariffs, dow, mod);
      if (t) {
        payable++;
        perTariff.set(t.pricePerHour, (perTariff.get(t.pricePerHour) ?? 0) + 1);
      }
    }
    cur.setMinutes(cur.getMinutes() + 1);
  }
  // округление: минимум + шаг вверх; добор минут — по последнему тарифу
  let billed = Math.max(payable, payable > 0 ? minChargeMin : 0);
  if (billed % stepMin) billed += stepMin - (billed % stepMin);
  const extra = billed - payable;
  if (extra > 0 && perTariff.size) {
    const last = [...perTariff.keys()].pop()!;
    perTariff.set(last, perTariff.get(last)! + extra);
  }
  let amount = 0;
  const breakdown = [...perTariff].map(([pricePerHour, minutes]) => {
    amount += Math.round((minutes / 60) * pricePerHour);
    return { pricePerHour, minutes };
  });
  return { billedMinutes: billed, amount, breakdown };
}

// ═══════════════ САЛОН: ЗАПИСИ ═══════════════

export interface Slot { startAt: Date; endAt: Date }

export function overlaps(a: Slot, b: Slot): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/** Проверка новой записи: рабочие часы мастера + отсутствие пересечений
 *  (double-booking запрещён — базовая гигиена, у Paloma не описана вовсе). */
export function validateAppointment(
  slot: Slot,
  masterSchedule: { dow: number; fromMin: number; toMin: number }[],
  existing: Slot[],
): void {
  const dow = (slot.startAt.getDay() + 6) % 7;
  const fromM = slot.startAt.getHours() * 60 + slot.startAt.getMinutes();
  const toM = slot.endAt.getHours() * 60 + slot.endAt.getMinutes();
  const inSchedule = masterSchedule.some(
    (w) => w.dow === dow && fromM >= w.fromMin && toM <= w.toMin,
  );
  if (!inSchedule) throw new VerticalError('OUT_OF_SCHEDULE', 'Мастер не работает в это время');
  for (const e of existing)
    if (overlaps(slot, e)) throw new VerticalError('DOUBLE_BOOKING', 'Время занято');
}

/** Свободные слоты дня для услуги длительностью durMin, сетка gridMin. */
export function freeSlots(
  day: Date,
  masterSchedule: { dow: number; fromMin: number; toMin: number }[],
  existing: Slot[],
  durMin: number,
  gridMin = 30,
): Slot[] {
  const dow = (day.getDay() + 6) % 7;
  const win = masterSchedule.filter((w) => w.dow === dow);
  const out: Slot[] = [];
  for (const w of win) {
    for (let m = w.fromMin; m + durMin <= w.toMin; m += gridMin) {
      const startAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
      const endAt = new Date(+startAt + durMin * 60_000);
      const slot = { startAt, endAt };
      if (!existing.some((e) => overlaps(slot, e))) out.push(slot);
    }
  }
  return out;
}

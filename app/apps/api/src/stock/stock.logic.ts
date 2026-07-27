// apps/api/src/stock/stock.logic.ts
// Чистая логика склада. Ledger-модель: остаток = свёртка движений.
// Себестоимость — скользящая средневзвешенная (Poster). Минусовые остатки
// разрешены (Paloma «актуализация»: 5−8=−3) — продажа не блокируется складом.

export type Money = number;   // тиыны
export type Qty = number;     // базовые единицы (г/мл/шт)

export interface Balance { qty: Qty; avgCost: Money }
export type BalanceMap = Map<string, Balance>; // key = `${warehouseId}:${productId}`

export class StockError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

const key = (wh: string, p: string) => `${wh}:${p}`;

export function getBal(b: BalanceMap, wh: string, p: string): Balance {
  return b.get(key(wh, p)) ?? { qty: 0, avgCost: 0 };
}

/** ПРИХОД: скользящая средневзвешенная (Poster how-the-cost-is-calculated).
 *  newAvg = (oldQty*oldAvg + inQty*inCost) / (oldQty+inQty).
 *  Крайний случай: остаток был ≤0 → средняя сбрасывается на цену прихода
 *  (иначе минусовой остаток отравляет среднюю — грабля, о которой молчат все 5). */
export function applySupply(b: BalanceMap, wh: string, p: string, inQty: Qty, inCost: Money): Balance {
  if (inQty <= 0) throw new StockError('BAD_QTY', 'Количество прихода должно быть > 0');
  if (inCost < 0) throw new StockError('BAD_COST', 'Цена не может быть отрицательной');
  const cur = getBal(b, wh, p);
  let avg: Money;
  if (cur.qty <= 0) avg = inCost;
  else avg = Math.round((cur.qty * cur.avgCost + inQty * inCost) / (cur.qty + inQty));
  const next = { qty: cur.qty + inQty, avgCost: avg };
  b.set(key(wh, p), next);
  return next;
}

/** РАСХОД (продажа/списание/возврат поставщику): qty уходит по текущей
 *  средней; остаток может уйти в минус (Paloma-математика). */
export function applyConsume(b: BalanceMap, wh: string, p: string, outQty: Qty): { taken: Qty; unitCost: Money; balance: Balance } {
  if (outQty <= 0) throw new StockError('BAD_QTY', 'Количество расхода должно быть > 0');
  const cur = getBal(b, wh, p);
  const next = { qty: cur.qty - outQty, avgCost: cur.avgCost };
  b.set(key(wh, p), next);
  return { taken: outQty, unitCost: cur.avgCost, balance: next };
}

/** ПЕРЕМЕЩЕНИЕ: расход со склада-источника по его средней, приход на
 *  склад-получатель ПО ТОЙ ЖЕ себестоимости (стоимость не «теряется»). */
export function applyTransfer(b: BalanceMap, fromWh: string, toWh: string, p: string, qty: Qty) {
  if (fromWh === toWh) throw new StockError('SAME_WH', 'Склады совпадают');
  const out = applyConsume(b, fromWh, p, qty);
  applySupply(b, toWh, p, qty, out.unitCost || 0);
  return out;
}

/** ПРОИЗВОДСТВО ПФ (QuickResto «акты приготовления» / Poster manufacture):
 *  списать ингредиенты по средней → оприходовать ПФ по СУММАРНОЙ себестоимости
 *  списанного / выход. Себестоимость ПФ рождается из реальных цен, не из
 *  теоретической техкарты. */
export function applyProduction(
  b: BalanceMap, wh: string,
  inputs: { productId: string; qty: Qty }[],
  output: { productId: string; qty: Qty },
): { outputUnitCost: Money } {
  if (output.qty <= 0) throw new StockError('BAD_QTY', 'Выход должен быть > 0');
  if (!inputs.length) throw new StockError('NO_INPUTS', 'Нет ингредиентов');
  let totalCost = 0;
  for (const i of inputs) {
    const r = applyConsume(b, wh, i.productId, i.qty);
    totalCost += Math.round(r.unitCost * i.qty);
  }
  const unitCost = Math.round(totalCost / output.qty);
  applySupply(b, wh, output.productId, output.qty, unitCost);
  return { outputUnitCost: unitCost };
}

/** РАЗДЕЛКА (QuickResto «акты разбора» / Poster butchery / Paloma «акт
 *  разделки»): одно целое → несколько частей. Себестоимость целого
 *  распределяется по частям пропорционально ДОЛЯМ СТОИМОСТИ (costShare),
 *  т.к. вырезка и кости из одной туши не равноценны — глубина iiko. */
export function applyButchering(
  b: BalanceMap, wh: string,
  input: { productId: string; qty: Qty },
  outputs: { productId: string; qty: Qty; costShare: number }[], // Σshare=1
): { parts: { productId: string; unitCost: Money }[] } {
  const shares = outputs.reduce((s, o) => s + o.costShare, 0);
  if (Math.abs(shares - 1) > 0.001)
    throw new StockError('BAD_SHARES', `Доли стоимости должны давать 1.0, сейчас ${shares}`);
  const r = applyConsume(b, wh, input.productId, input.qty);
  const totalCost = Math.round(r.unitCost * input.qty);
  const parts = outputs.map((o) => {
    const unitCost = o.qty > 0 ? Math.round((totalCost * o.costShare) / o.qty) : 0;
    applySupply(b, wh, o.productId, o.qty, unitCost);
    return { productId: o.productId, unitCost };
  });
  return { parts };
}

// ═══════════ ИНВЕНТАРИЗАЦИЯ БЕЗ ОСТАНОВКИ ПРОДАЖ (Paloma) ═══════════
// Механизм: фиксируем точку отсчёта T и книжный остаток на T. Пока идёт
// пересчёт, продажи/приходы продолжаются. Расхождение считается так:
//   ожидаемое_на_момент_проведения = факт_пересчёта + (движения после T)
//   расхождение = ожидаемое − книжный_на_проведение
// т.е. операции «во время пересчёта» не искажают результат.

export interface InvLine {
  productId: string;
  bookAtStart: Qty;    // книжный остаток на момент T (снимок)
  counted: Qty;        // фактический пересчёт
  movedAfterStart: Qty; // Σ qtyDelta движений ПОСЛЕ T (продажи −, приходы +)
}

export function inventoryDiff(line: InvLine): { expectedNow: Qty; bookNow: Qty; diff: Qty } {
  const bookNow = line.bookAtStart + line.movedAfterStart;
  const expectedNow = line.counted + line.movedAfterStart;
  return { expectedNow, bookNow, diff: expectedNow - bookNow }; // = counted − bookAtStart
}

/** Проведение инвентаризации: корректирующее движение = diff.
 *  Плюс — оприходование излишка по текущей средней; минус — списание. */
export function applyInventory(b: BalanceMap, wh: string, line: InvLine): { diff: Qty } {
  const { diff } = inventoryDiff(line);
  if (diff > 0) applySupply(b, wh, line.productId, diff, getBal(b, wh, line.productId).avgCost || 0);
  else if (diff < 0) applyConsume(b, wh, line.productId, -diff);
  return { diff };
}

// ═══════════ АКТУАЛИЗАЦИЯ ОСТАТКОВ (Paloma, розница) ═══════════
// Массовая корректировка минусов: для товаров с qty<0 создаётся оприходование
// до 0 (или до факта). Возвращает список корректировок для документа SURPLUS.
export function actualizeNegatives(b: BalanceMap, wh: string, productIds: string[]):
  { productId: string; correction: Qty }[] {
  const out: { productId: string; correction: Qty }[] = [];
  for (const p of productIds) {
    const cur = getBal(b, wh, p);
    if (cur.qty < 0) {
      out.push({ productId: p, correction: -cur.qty });
      applySupply(b, wh, p, -cur.qty, cur.avgCost || 0);
    }
  }
  return out;
}

// ═══════════ ПРОВЕДЕНИЕ / РАСПРОВЕДЕНИЕ ═══════════
export type DocStatus = 'DRAFT' | 'POSTED' | 'VOIDED';

export function canPost(status: DocStatus): boolean { return status === 'DRAFT'; }
export function canVoid(status: DocStatus): boolean { return status === 'POSTED'; }

/** Сторно: распроведение создаёт обратные движения (не удаляет историю!) —
 *  аудит полный, «почему остаток такой» всегда разложимо. */
export function stornoMovements(movs: { productId: string; qtyDelta: Qty; unitCost: Money }[]) {
  return movs.map((m) => ({ ...m, qtyDelta: -m.qtyDelta }));
}

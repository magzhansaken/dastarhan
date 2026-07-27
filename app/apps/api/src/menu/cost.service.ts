// apps/api/src/menu/cost.service.ts
// РАСЧЁТ СЕБЕСТОИМОСТИ — сердце этапа 1.
// Модель (объединение лучшего):
//  - Poster how-the-cost-is-calculated: себестоимость ингредиента =
//    средневзвешенная цена по поставкам; себестоимость блюда = сумма по
//    техкарте (списание по БРУТТО!).
//  - iiko: вложенные полуфабрикаты → рекурсивный расчёт.
//  - QuickResto versionnost: считаем по версии техкарты, действующей НА ДАТУ
//    (прошлые продажи не пересчитываются при смене рецепта).
// Чистые функции без БД — тестируемы изолированно; сервис-обёртка грузит данные.

export interface CostContext {
  /** Средневзвешенная закупочная цена компонента за базовую единицу, тиыны.
   *  Источник: приходы склада (Этап 4); до него — ручная цена закупки. */
  ingredientCost: Map<string, number>;
  /** Действующие техкарты на дату расчёта: productId -> техкарта */
  techCards: Map<string, TechCardData>;
  /** Тип продукта: без техкарты (GOODS/INGREDIENT) стоимость = закупочная */
  productType: Map<string, string>;
}

export interface TechCardData {
  productId: string;
  version: number;
  outputQty: number; // выход в базовых единицах
  lines: { componentId: string; bruttoQty: number }[];
}

export class CycleError extends Error {
  constructor(public chain: string[]) {
    super(`Цикл в техкартах: ${chain.join(' → ')}`);
  }
}

/**
 * Себестоимость ОДНОЙ базовой единицы продукта (тиын/грамм, тиын/мл, тиын/шт).
 * Рекурсия по PREPACK; защита от циклов (соус в тесте, тесто в соусе — ошибка,
 * а не зависание: у конкурентов это узкое место, мы валидируем).
 */
export function unitCost(
  productId: string,
  ctx: CostContext,
  _chain: string[] = [],
): number {
  if (_chain.includes(productId)) throw new CycleError([..._chain, productId]);

  const tc = ctx.techCards.get(productId);
  if (!tc) {
    // GOODS/INGREDIENT/SERVICE: закупочная цена за единицу (SERVICE → 0)
    return ctx.ingredientCost.get(productId) ?? 0;
  }
  // DISH/PREPACK: сумма (брутто × стоимость единицы компонента) / выход
  let total = 0;
  for (const line of tc.lines) {
    const c = unitCost(line.componentId, ctx, [..._chain, productId]);
    total += line.bruttoQty * c; // списание по БРУТТО — как Poster/iiko
  }
  return tc.outputQty > 0 ? total / tc.outputQty : total;
}

/** Себестоимость порции блюда (= unitCost × выход порции). */
export function portionCost(productId: string, ctx: CostContext): number {
  const tc = ctx.techCards.get(productId);
  if (!tc) return ctx.ingredientCost.get(productId) ?? 0;
  return unitCost(productId, ctx) * tc.outputQty;
}

/** Фудкост в % = себестоимость / цена продажи (метрика Poster/Postie). */
export function foodCostPct(portionCostT: number, salePriceT: number): number {
  return salePriceT > 0 ? (portionCostT / salePriceT) * 100 : 0;
}

/**
 * Полное списание по продаже: разворачивает блюдо до листовых компонентов
 * (ингредиенты/товары), включая вклад ВЫБРАННЫХ модификаторов.
 * Основа для Этапа 4 (склад): продажа → авто-списание.
 */
export interface ModifierSelection { componentId: string; qty: number }

export function explodeWriteOff(
  productId: string,
  qtyPortions: number,
  ctx: CostContext,
  modifiers: ModifierSelection[] = [],
  _chain: string[] = [],
): Map<string, number> {
  if (_chain.includes(productId)) throw new CycleError([..._chain, productId]);
  const out = new Map<string, number>();
  const add = (id: string, q: number) => out.set(id, (out.get(id) ?? 0) + q);

  const tc = ctx.techCards.get(productId);
  if (!tc) {
    add(productId, qtyPortions); // товар списывается сам
  } else {
    for (const line of tc.lines) {
      const need = line.bruttoQty * qtyPortions; // брутто на порцию × порции
      const sub = ctx.techCards.get(line.componentId);
      if (sub) {
        // полуфабрикат: рекурсивно, пересчитав порции ПФ через его выход
        const subPortions = need / sub.outputQty;
        for (const [id, q] of explodeWriteOff(
          line.componentId, subPortions, ctx, [], [..._chain, productId],
        )) add(id, q);
      } else {
        add(line.componentId, need);
      }
    }
  }
  for (const m of modifiers) add(m.componentId, m.qty * qtyPortions);
  return out;
}

/** Выбор версии техкарты, действующей на дату (QuickResto versionnost). */
export function pickVersion<T extends { effectiveFrom: Date; version: number }>(
  versions: T[],
  at: Date,
): T | undefined {
  return versions
    .filter((v) => v.effectiveFrom <= at)
    .sort((a, b) => b.version - a.version)[0];
}

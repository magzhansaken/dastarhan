// apps/api/src/ai/ai.logic.ts
// Детерминированная логика вокруг LLM. Принцип: LLM извлекает сырые данные
// (vision/парсинг), а МАТЧИНГ, КАТЕГОРИЗАЦИЯ и ВАЛИДАЦИЯ — прозрачные
// алгоритмы с объяснимым скорингом. Тестируется без LLM.

export type Money = number;

// ═══════════════ МАТЧИНГ ПОЗИЦИЙ НАКЛАДНОЙ ═══════════════

/** Нормализация товарного имени: регистр, ё, единицы, проценты, мусор. */
export function normalizeItemName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"']/g, '')
    .replace(/\d+([.,]\d+)?\s*(л|мл|кг|г|шт|уп|%)/g, ' ')  // объёмы/жирность — не суть
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(w: string): string {
  // грубый стем: срезаем частые окончания, чтобы «говяжья»/«говядина»,
  // «томатный»/«томат» сходились по основе (достаточно 5 первых букв корня)
  const cut = w.replace(/(ами|ями|ыми|ими|ого|его|ому|ему|ая|яя|ый|ий|ое|ее|ой|ей|ья|ин|ина|ы|и|а|я|о|е|ь)$/,'');
  return (cut.length >= 4 ? cut : w).slice(0, 4); // 4 буквы корня: «говяж/говяд» → «говя»
}

function tokens(s: string): Set<string> {
  return new Set(normalizeItemName(s).split(' ').filter((t) => t.length > 1).map(stem));
}

/** Скоринг схожести: Жаккар по токенам + бонус за вхождение подстроки.
 *  Прозрачно: UI показывает «почему сматчилось» (общие слова). */
export function matchScore(rawName: string, productName: string): number {
  const a = tokens(rawName), b = tokens(productName);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const jaccard = inter / (a.size + b.size - inter);
  const substr = normalizeItemName(productName).includes(normalizeItemName(rawName)) ||
                 normalizeItemName(rawName).includes(normalizeItemName(productName)) ? 0.2 : 0;
  return Math.min(1, jaccard + substr);
}

export interface MatchCandidate { productId: string; name: string }
export interface MatchResult {
  productId: string | null; score: number;
  status: 'ALIAS' | 'AUTO' | 'SUGGEST' | 'NEW';
}

/** Порог: alias → 1.0; ≥0.75 авто; ≥0.4 подсказка; ниже — «создать новый».
 *  Alias-память (подтверждённые ранее) бьёт всё — второй раз не спрашиваем. */
export function matchProduct(
  rawName: string,
  candidates: MatchCandidate[],
  aliases: Map<string, string>, // normalizedRaw -> productId
): MatchResult {
  const alias = aliases.get(normalizeItemName(rawName));
  if (alias) return { productId: alias, score: 1, status: 'ALIAS' };
  let best: { productId: string; score: number } | null = null;
  for (const c of candidates) {
    const s = matchScore(rawName, c.name);
    if (!best || s > best.score) best = { productId: c.productId, score: s };
  }
  if (!best || best.score < 0.4) return { productId: null, score: best?.score ?? 0, status: 'NEW' };
  if (best.score >= 0.75) return { ...best, status: 'AUTO' };
  return { ...best, status: 'SUGGEST' };
}

// ═══════════════ ЧЕРНОВИК ПОСТАВКИ: ВАЛИДАЦИЯ ═══════════════

export interface DraftSupplyLine { rawName: string; qty: number; unitCost: Money; sum: Money }

/** Арифметика накладной: qty×цена = сумма строки (±1 тиын округления),
 *  Σ строк = итог. LLM ошибается в цифрах — мы ловим ДО черновика. */
export function validateDraftSupply(lines: DraftSupplyLine[], total: Money):
  { ok: boolean; lineErrors: number[]; totalMismatch: Money } {
  const lineErrors: number[] = [];
  let sum = 0;
  lines.forEach((l, i) => {
    if (Math.abs(l.qty * l.unitCost - l.sum) > 1) lineErrors.push(i);
    sum += l.sum;
  });
  return { ok: lineErrors.length === 0 && Math.abs(sum - total) <= 1, lineErrors, totalMismatch: sum - total };
}

// ═══════════════ ВЫПИСКИ: КАТЕГОРИЗАЦИЯ (КЗ-мерчанты) ═══════════════

export interface MerchantRule { pattern: string; category: string }

/** Глобальные правила платформы — казахстанские мерчанты из коробки
 *  (у Postie нет КЗ). Пользовательские правила добавляются поверх. */
export const KZ_MERCHANT_RULES: MerchantRule[] = [
  { pattern: 'magnum', category: 'Закупка продуктов' },
  { pattern: 'small', category: 'Закупка продуктов' },
  { pattern: 'metro', category: 'Закупка продуктов' },
  { pattern: 'казтрансгаз', category: 'Коммунальные' },
  { pattern: 'qazaqgaz', category: 'Коммунальные' },
  { pattern: 'алматы су', category: 'Коммунальные' },
  { pattern: 'астана су', category: 'Коммунальные' },
  { pattern: 'алматыэнергосбыт', category: 'Коммунальные' },
  { pattern: 'аренда', category: 'Аренда' },
  // ПОРЯДОК ВАЖЕН: специфичные мерчанты — РАНЬШЕ общих слов («комиссия»),
  // иначе «WOLT комиссия» уйдёт в банковские комиссии (пойман тестом)
  { pattern: 'wolt', category: 'Комиссия агрегаторов' },
  { pattern: 'glovo', category: 'Комиссия агрегаторов' },
  { pattern: 'kaspi red', category: 'Комиссии банка' },
  { pattern: 'зарплат', category: 'ФОТ' },
  { pattern: 'комиссия', category: 'Комиссии банка' },
];

export function categorizeTx(
  description: string,
  userRules: MerchantRule[],
  globalRules: MerchantRule[] = KZ_MERCHANT_RULES,
): { category: string; matchedBy: 'user' | 'global' | null } {
  const d = description.toLowerCase();
  for (const r of userRules) if (d.includes(r.pattern.toLowerCase())) return { category: r.category, matchedBy: 'user' };
  for (const r of globalRules) if (d.includes(r.pattern.toLowerCase())) return { category: r.category, matchedBy: 'global' };
  return { category: 'Прочее (уточнить)', matchedBy: null };
}

// ═══════════════ ОТЧЁТ ПО ТЕКСТОВОМУ ЗАПРОСУ ═══════════════
// LLM разбирает язык, но ПЕРИОДЫ считаем детерминированно (LLM путает даты).

export type ReportKind = 'sales' | 'foodcost' | 'cashflow' | 'abc' | 'top_products';

export function detectReportKind(q: string): ReportKind | null {
  const s = q.toLowerCase();
  if (/(фудкост|себестоим)/.test(s)) return 'foodcost';
  if (/(движени|деньг|cash|ддс)/.test(s)) return 'cashflow';
  if (/(abc|абс)/.test(s)) return 'abc';
  if (/(топ|лучше всего|хиты|популярн)/.test(s)) return 'top_products';
  if (/(продаж|выручк|оборот)/.test(s)) return 'sales';
  return null;
}

/** «вчера», «за неделю», «за июль», «с 1 по 15 июля» → [from, to). */
export function parsePeriod(q: string, now: Date): { from: Date; to: Date } {
  const s = q.toLowerCase();
  const day = 24 * 3600 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(now);
  if (/сегодня/.test(s)) return { from: today, to: new Date(+today + day) };
  if (/вчера/.test(s)) return { from: new Date(+today - day), to: today };
  if (/недел/.test(s)) return { from: new Date(+today - 7 * day), to: new Date(+today + day) };
  if (/месяц/.test(s)) return { from: new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()), to: new Date(+today + day) };
  const months = ['январ','феврал','март','апрел','ма[йя]','июн','июл','август','сентябр','октябр','ноябр','декабр'];
  for (let m = 0; m < 12; m++) {
    if (new RegExp(`за\\s+${months[m]}`).test(s)) {
      const y = now.getMonth() >= m ? now.getFullYear() : now.getFullYear() - 1;
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
    }
  }
  return { from: new Date(+today - 7 * day), to: new Date(+today + day) }; // дефолт: неделя
}

// ═══════════════ ФУДКОСТ-СИГНАЛЫ (правила, не LLM — Postie-функция 4) ═══════

export interface FoodcostRow {
  productId: string; name: string;
  planPct: number;   // фудкост по техкарте при текущих ценах
  factPct: number;   // фактический (со списаниями/потерями)
  salesShare: number; // доля в выручке 0..1 — важность
}

export interface FoodcostAlert {
  productId: string; name: string; deltaPp: number;
  severity: 'HIGH' | 'MEDIUM';
  hint: string;
}

/** Алерт, если факт хуже плана на ≥ порога; HIGH — если позиция ещё и
 *  значима в выручке. Подсказка — как у Postie: что делать именно сейчас. */
export function foodcostAlerts(rows: FoodcostRow[], thresholdPp = 3): FoodcostAlert[] {
  const out: FoodcostAlert[] = [];
  for (const r of rows) {
    const delta = +(r.factPct - r.planPct).toFixed(1);
    if (delta < thresholdPp) continue;
    const severity = r.salesShare >= 0.05 ? 'HIGH' : 'MEDIUM';
    const hint = delta >= 8
      ? 'Проверьте техкарту и порции: перерасход системный — возможно, изменилась закупочная цена, поднимите цену или смените поставщика'
      : 'Проверьте списания и потери за период: похоже на разовый перерасход';
    out.push({ productId: r.productId, name: r.name, deltaPp: delta, severity, hint });
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.deltaPp - a.deltaPp : a.severity === 'HIGH' ? -1 : 1));
}

import { normalizeItemName, matchScore, matchProduct, validateDraftSupply,
  categorizeTx, KZ_MERCHANT_RULES, detectReportKind, parsePeriod, foodcostAlerts } from './ai.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};

// ═══ Нормализация и матчинг ═══
eq('нормализация: объёмы/жирность прочь', normalizeItemName('Молоко «Отборное» 3,2% 1л'), 'молоко отборное');
eq('ё → е', normalizeItemName('Свёкла'), 'свекла');

const cands = [
  { productId:'milk', name:'Молоко' },
  { productId:'milk_otb', name:'Молоко отборное' },
  { productId:'beef', name:'Говядина вырезка' },
];
// точное alias-совпадение бьёт всё
const aliases = new Map([['молоко отборное', 'milk_otb']]);
eq('alias мгновенно', matchProduct('Молоко Отборное 3.2% 1л', cands, aliases),
   { productId:'milk_otb', score:1, status:'ALIAS' });
// авто-матч без алиаса
const m1 = matchProduct('Молоко отборное 1л', cands, new Map());
eq('авто ≥0.75', [m1.productId, m1.status], ['milk_otb','AUTO']);
// подсказка при среднем скоре
const m2 = matchProduct('Вырезка говяжья охл.', cands, new Map());
eq('подсказка говядины', [m2.productId, m2.status], ['beef','SUGGEST']);
// незнакомое → новый
const m3 = matchProduct('Кетчуп томатный', cands, new Map());
eq('незнакомое → NEW', [m3.productId, m3.status], [null,'NEW']);

// ═══ Арифметика черновика накладной ═══
const good = validateDraftSupply([
  { rawName:'Молоко', qty:10, unitCost:40_000, sum:400_000 },
  { rawName:'Мука', qty:5, unitCost:20_000, sum:100_000 },
], 500_000);
eq('накладная сходится', good.ok, true);
const bad = validateDraftSupply([
  { rawName:'Молоко', qty:10, unitCost:40_000, sum:450_000 }, // LLM ошибся
], 450_000);
eq('строка не сходится → индекс 0', bad.lineErrors, [0]);
const bad2 = validateDraftSupply([
  { rawName:'A', qty:1, unitCost:100, sum:100 },
], 150);
eq('итог не сходится', [bad2.ok, bad2.totalMismatch], [false, -50]);

// ═══ Категоризация КЗ-мерчантов ═══
eq('Magnum → закупка', categorizeTx('Оплата MAGNUM ALMATY KZ', [], KZ_MERCHANT_RULES).category, 'Закупка продуктов');
eq('КазТрансГаз → коммуналка', categorizeTx('АО КазТрансГаз Аймак', [], KZ_MERCHANT_RULES).category, 'Коммунальные');
eq('Wolt → комиссия агрегаторов', categorizeTx('WOLT KAZAKHSTAN комиссия', [], KZ_MERCHANT_RULES).category, 'Комиссия агрегаторов');
// пользовательское правило приоритетнее глобального
const user = [{ pattern:'magnum', category:'Хозтовары' }];
eq('user-правило бьёт глобальное', categorizeTx('MAGNUM', user).matchedBy, 'user');
eq('незнакомый → уточнить', categorizeTx('ИП Ерболат перевод', []).category, 'Прочее (уточнить)');

// ═══ Отчёт по запросу ═══
eq('вид: продажи', detectReportKind('покажи продажи за вчера'), 'sales');
eq('вид: фудкост', detectReportKind('что с фудкостом?'), 'foodcost');
eq('вид: топ', detectReportKind('что лучше всего продаётся'), 'top_products');
eq('вид: не понял', detectReportKind('привет'), null);

const now = new Date(2026, 6, 19, 15, 0); // 19 июля 2026
let p = parsePeriod('продажи за вчера', now);
eq('вчера = 18 июля', [p.from.getDate(), p.to.getDate()], [18, 19]);
p = parsePeriod('выручка за июль', now);
eq('за июль = 1.07–1.08', [p.from.getMonth(), p.from.getDate(), p.to.getMonth()], [6, 1, 7]);
p = parsePeriod('оборот за март', now);
eq('март в прошлом = 2026', p.from.getFullYear(), 2026);

// ═══ Фудкост-сигналы ═══
const alerts = foodcostAlerts([
  { productId:'plov', name:'Плов', planPct:30, factPct:41, salesShare:0.2 },   // +11пп, значимый
  { productId:'tea', name:'Чай', planPct:10, factPct:14.5, salesShare:0.01 }, // +4.5пп, мелкий
  { productId:'ok', name:'Салат', planPct:25, factPct:26, salesShare:0.1 },   // норм
]);
eq('2 алерта, плов первый (HIGH)', alerts.map(a=>[a.productId, a.severity]),
   [['plov','HIGH'],['tea','MEDIUM']]);
eq('плов: системная подсказка', alerts[0].hint.includes('техкарту'), true);
eq('чай: разовый перерасход', alerts[1].hint.includes('разовый'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

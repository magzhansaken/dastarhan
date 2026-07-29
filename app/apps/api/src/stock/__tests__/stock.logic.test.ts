import { applySupply, applyConsume, applyTransfer, applyProduction, applyButchering,
  inventoryDiff, applyInventory, actualizeNegatives, canPost, canVoid, stornoMovements,
  getBal, StockError } from '../../../../../packages/shared/src/stock/stock.logic.ts';
import type { BalanceMap, InvLine } from '../../../../../packages/shared/src/stock/stock.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as StockError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};

// ═══ Средневзвешенная себестоимость (Poster) ═══
const b: BalanceMap = new Map();
// молоко: 10л по 400тг/л (40000 тиын), потом 10л по 600тг/л → средняя 500тг
applySupply(b, 'wh1', 'milk', 10_000, 40);   // тиын за мл: 400тг/л = 40 тиын/мл... возьмём за мл
applySupply(b, 'wh1', 'milk', 10_000, 60);
eq('средневзвешенная 40+60→50', getBal(b,'wh1','milk').avgCost, 50);
eq('остаток 20л', getBal(b,'wh1','milk').qty, 20_000);

// расход по средней; минус разрешён (Paloma 5−8=−3)
const c1 = applyConsume(b, 'wh1', 'milk', 25_000);
eq('расход по средней 50', c1.unitCost, 50);
eq('остаток ушёл в минус −5л', getBal(b,'wh1','milk').qty, -5_000);

// приход при минусе: средняя СБРАСЫВАЕТСЯ на цену прихода (не отравляется)
applySupply(b, 'wh1', 'milk', 10_000, 70);
eq('минус → средняя = цене прихода', getBal(b,'wh1','milk').avgCost, 70);
eq('остаток 5л', getBal(b,'wh1','milk').qty, 5_000);

// ═══ Перемещение: себестоимость едет со складом ═══
applySupply(b, 'wh1', 'beef', 5_000, 300);
applyTransfer(b, 'wh1', 'wh2', 'beef', 2_000);
eq('источник −2кг', getBal(b,'wh1','beef').qty, 3_000);
eq('получатель +2кг ПО ТОЙ ЖЕ цене', [getBal(b,'wh2','beef').qty, getBal(b,'wh2','beef').avgCost], [2_000, 300]);
throws('перемещение сам в себя', ()=>applyTransfer(b,'wh1','wh1','beef',100), 'SAME_WH');

// ═══ Производство ПФ: себестоимость из реальных цен ═══
const b2: BalanceMap = new Map();
applySupply(b2,'k','flour',10_000, 2);   // мука 10кг по 2 тиын/г
applySupply(b2,'k','water', 5_000, 0);   // вода бесплатна
const prod = applyProduction(b2,'k',
  [{productId:'flour', qty:6_000},{productId:'water', qty:3_000}],
  {productId:'dough', qty:8_500});       // тесто, выход 8.5кг
eq('себестоимость теста = 12000/8500', prod.outputUnitCost, Math.round(12_000/8_500));
eq('мука списана', getBal(b2,'k','flour').qty, 4_000);
eq('тесто оприходовано', getBal(b2,'k','dough').qty, 8_500);
throws('производство без входов', ()=>applyProduction(b2,'k',[],{productId:'x',qty:1}), 'NO_INPUTS');

// ═══ Разделка по долям стоимости (iiko-глубина) ═══
const b3: BalanceMap = new Map();
applySupply(b3,'k','carcass', 20_000, 25);  // туша 20кг по 25 тиын/г = 500 000 тиын
const cut = applyButchering(b3,'k',
  {productId:'carcass', qty:20_000},
  [
    {productId:'tenderloin', qty:3_000, costShare:0.5},  // вырезка: 50% стоимости
    {productId:'meat',       qty:12_000, costShare:0.45},
    {productId:'bones',      qty:4_000, costShare:0.05}, // кости почти ничего
  ]);
eq('вырезка дорогая: 250000/3000', cut.parts[0].unitCost, Math.round(250_000/3_000));
eq('кости дешёвые: 25000/4000', cut.parts[2].unitCost, Math.round(25_000/4_000));
eq('туша списана', getBal(b3,'k','carcass').qty, 0);
throws('доли ≠ 1.0', ()=>applyButchering(b3,'k',{productId:'carcass',qty:1},[{productId:'x',qty:1,costShare:0.7}]), 'BAD_SHARES');

// ═══ Инвентаризация БЕЗ остановки продаж (Paloma) ═══
// Книжный на старте 100 шт; пока считали — продали 20 (moved −20);
// насчитали фактически 95 → недостача 5, а НЕ 25!
const line: InvLine = { productId:'cola', bookAtStart:100, counted:95, movedAfterStart:-20 };
const d = inventoryDiff(line);
eq('расхождение = counted − bookAtStart = −5', d.diff, -5);
eq('книжный сейчас 80', d.bookNow, 80);
eq('ожидаемый сейчас 75', d.expectedNow, 75);
// проведение: недостача списывается
const b4: BalanceMap = new Map();
applySupply(b4,'shop','cola', 80, 150);  // текущий книжный 80
applyInventory(b4,'shop',line);
eq('после проведения остаток 75', getBal(b4,'shop','cola').qty, 75);

// излишек оприходуется
const b5: BalanceMap = new Map();
applySupply(b5,'shop','chips', 50, 200);
applyInventory(b5,'shop',{productId:'chips', bookAtStart:50, counted:53, movedAfterStart:0});
eq('излишек +3 оприходован', getBal(b5,'shop','chips').qty, 53);

// ═══ Актуализация минусов (Paloma розница) ═══
const b6: BalanceMap = new Map();
applySupply(b6,'shop','bread', 5, 100);
applyConsume(b6,'shop','bread', 8);   // 5−8=−3
const corr = actualizeNegatives(b6,'shop',['bread','cola']);
eq('коррекция +3 для хлеба', corr, [{productId:'bread', correction:3}]);
eq('остаток стал 0', getBal(b6,'shop','bread').qty, 0);

// ═══ Проведение/сторно ═══
eq('DRAFT можно провести', canPost('DRAFT'), true);
eq('POSTED нельзя провести повторно', canPost('POSTED'), false);
eq('POSTED можно распровести', canVoid('POSTED'), true);
const st = stornoMovements([{productId:'x', qtyDelta:5, unitCost:10},{productId:'y', qtyDelta:-3, unitCost:20}]);
eq('сторно инвертирует знаки', st.map(m=>m.qtyDelta), [-5, 3]);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

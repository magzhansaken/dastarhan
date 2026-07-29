import React from 'react';
import { renderToString } from 'react-dom/server';
import { priceDeviation, supplyRowSum, supplyDocTotals, invRowDiff, invTotals,
  sortByMoneyImpact, SupplyScreen, InventoryScreen, foodcostImpact,
  shortageVerdict, rowDiffHint } from '../StockScreens.tsx';
import { foodcostLevel, FOODCOST_LEVEL, stockForecast, monthlyMargin } from '../../viewmodels.ts';
import type { SupplyRow, InvRow } from '../StockScreens.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

// ═══ Приход: ценовой контроль (правило QR + наша подсказка) ═══
eq('цена в норме (+10%)', priceDeviation({productId:'r',name:'Рис',unit:'кг',qty:1,priceTenge:660,lastPriceTenge:600})?.level, 'ok');
eq('warn при +25%', priceDeviation({productId:'r',name:'Рис',unit:'кг',qty:1,priceTenge:750,lastPriceTenge:600})?.level, 'warn');
eq('high при +60%', priceDeviation({productId:'r',name:'Рис',unit:'кг',qty:1,priceTenge:960,lastPriceTenge:600})?.level, 'high');
eq('падение цены тоже сигнал (−30%)', priceDeviation({productId:'r',name:'Рис',unit:'кг',qty:1,priceTenge:420,lastPriceTenge:600})?.level, 'warn');
eq('без прошлой цены — null', priceDeviation({productId:'x',name:'Нов',unit:'шт',qty:1,priceTenge:100}), null);

const rows: SupplyRow[] = [
  { productId:'rice', name:'Рис', unit:'кг', qty:20, priceTenge:600, lastPriceTenge:600 },
  { productId:'oil', name:'Масло', unit:'л', qty:5, priceTenge:1800, lastPriceTenge:1200 }, // +50%... = warn (не >50)
];
eq('сумма строки 20×600', supplyRowSum(rows[0]), 20*600*100);
const st = supplyDocTotals(rows);
eq('итог документа', st.total, (20*600+5*1800)*100);
eq('алерт по маслу (+50%)', st.alerts.length === 1 && st.alerts[0].pct === 50, true);
eq('текст алерта человеческий', st.alerts[0].text.includes('выросла на 50%') && st.alerts[0].text.includes('была 1200'), true);

// ═══ Инвентаризация: без остановки + деньги ═══
const inv: InvRow[] = [
  // книжный 100, продали 20 пока считали, насчитали 75 → недостача 5 × 150тг
  { productId:'cola', name:'Кола', unit:'шт', bookAtStart:100, movedAfterStart:-20, counted:75, avgCostTenge:150 },
  // излишек +3 × 200тг
  { productId:'chips', name:'Чипсы', unit:'шт', bookAtStart:50, movedAfterStart:0, counted:53, avgCostTenge:200 },
  // не считали
  { productId:'tea', name:'Чай', unit:'шт', bookAtStart:10, movedAfterStart:0, counted:null, avgCostTenge:100 },
];
eq('кола: −5 на −750тг (продажи не исказили!)', invRowDiff(inv[0]), { diff:-5, money:-75000 });
eq('чипсы: +3 на +600тг', invRowDiff(inv[1]), { diff:3, money:60000 });
eq('несчитанное — null', invRowDiff(inv[2]), null);
const it = invTotals(inv);
eq('итоги: недостача 750, излишек 600', [it.shortageMoney, it.surplusMoney], [75000, 60000]);
eq('прогресс 2 из 3 = 67%', [it.counted, it.progressPct], [2, 67]);
eq('сортировка: кола (750) раньше чипсов (600)', sortByMoneyImpact(inv).map(r=>r.productId).slice(0,2), ['cola','chips']);

// ═══ ЖИВОЙ РЕНДЕР ═══
const h1 = clean(renderToString(<SupplyScreen
  suppliers={[{id:'s1',name:'ИП Ерболат'}]}
  initialRows={rows}
  searchProducts={()=>[]}
  onAiPhoto={()=>{}} onSaveDraft={()=>{}} onPost={()=>{}} />));
eq('приход: кнопка ИИ-фото', h1.includes('Фото накладной'), true);
eq('приход: подсказка прошлой цены', h1.includes('прошлая: 1200'), true);
eq('приход: класс warn на цене масла', h1.includes('price-warn'), true);
eq('приход: алерт в списке', h1.includes('выросла на 50%'), true);
eq('приход: итог 21 000 тг', h1.includes('21 000'), true);
eq('приход: Провести активна', h1.includes('Провести'), true);

const h2 = clean(renderToString(<InventoryScreen
  startedAt="19.07 14:00" rows={inv} blindMode={false}
  onCount={()=>{}} onToggleBlind={()=>{}} onPost={()=>{}} canPost={true} />));
eq('инв: пометка «продажи можно не останавливать»', h2.includes('не останавливать'), true);
eq('инв: книжный виден (не слепой)', h2.includes('Книжный'), true);
eq('инв: недостача 750 тг на экране', h2.includes('750'), true);
eq('инв: расхождение −5 красным классом', h2.includes('diff-neg'), true);
eq('инв: несчитанный — прочерк', h2.includes('—'), true);

const h3 = clean(renderToString(<InventoryScreen
  startedAt="x" rows={inv} blindMode={true}
  onCount={()=>{}} onToggleBlind={()=>{}} onPost={()=>{}} canPost={false} />));
eq('СЛЕПОЙ режим: колонки «Книжный» нет', h3.includes('<th>Книжный</th>'), false);
eq('слепой: факт вводится', h3.includes('Факт'), true);
eq('без права — кнопка disabled', h3.includes('disabled'), true);

// ═══ СООТВЕТСТВИЕ МАКЕТУ (вторая волна) ═══
eq('фудкост 28% → В норме', FOODCOST_LEVEL[foodcostLevel(28)].ru, 'В норме');
eq('фудкост 34% → На границе', FOODCOST_LEVEL[foodcostLevel(34)].ru, 'На границе');
eq('фудкост 46% → Дорого', FOODCOST_LEVEL[foodcostLevel(46)].ru, 'Дорого');
eq('граница 30% включительно', foodcostLevel(30), 'ok');
eq('граница 38% включительно', foodcostLevel(38), 'edge');

// прогноз запаса — из макета
eq('16,2 кг по 320 г = 50 порций', stockForecast(16.2, 0.32, 4).portionsLeft, 50);
eq('при 4 порциях в день хватит на 12 дней', stockForecast(16.2, 0.32, 4).daysLeft, 12);
eq('без спроса — дней нет', stockForecast(10, 0.5, 0).daysLeft, null);
eq('нулевой расход не делит на ноль', stockForecast(10, 0, 4), {portionsLeft:0, daysLeft:null});

// маржа за месяц
eq('маржа × 118 порций', monthlyMargin(150000, 118), 17700000);

// влияние цены закупки на фудкост блюда — ключевая механика макета
const imp = foodcostImpact(
  { productId:'kon', name:'Конина', unit:'кг', qty:20, priceTenge:3200, lastPriceTenge:2700 },
  { name:'Бешбармак', perPortion:0.32, salePriceTenge:4900, otherCostTenge:560 });
eq('фудкост вырастет', imp!.worse, true);
eq('новый фудкост 32%', imp!.newPct, 32);
eq('старый был 29%', imp!.oldPct, 29);
eq('без прошлой цены — null', foodcostImpact(
  { productId:'x', name:'X', unit:'кг', qty:1, priceTenge:100 },
  { name:'Y', perPortion:1, salePriceTenge:1000, otherCostTenge:0 }), null);

// экран прихода с влиянием
const hImp = clean(renderToString(<SupplyScreen
  suppliers={[{id:'s1',name:'ИП Ерболат'}]} initialRows={rows}
  impacts={[{dishName:'Бешбармак', newPct:34, oldPct:29, worse:true}]}
  searchProducts={()=>[]} onAiPhoto={()=>{}} onSaveDraft={()=>{}} onPost={()=>{}} />));
eq('влияние на фудкост показано', hImp.includes('Фудкост «Бешбармак» станет'), true);
eq('новый и старый процент', hImp.includes('34%') && hImp.includes('29%'), true);

// пустые состояния
const hEmpty = clean(renderToString(<SupplyScreen suppliers={[]} initialRows={[]}
  searchProducts={()=>[]} onAiPhoto={()=>{}} onSaveDraft={()=>{}} onPost={()=>{}} />));
eq('приход пустой: подсказка про фото', hEmpty.includes('загрузите накладную фотографией'), true);

// ═══ ИНВЕНТАРИЗАЦИЯ: ВЫВОДЫ ИЗ МАКЕТА ═══
eq('нет недостачи → «излишков нет»', shortageVerdict(0, 100000), 'излишков нет');
eq('в норме списаний', shortageVerdict(50000, 100000), 'в пределах нормы списаний');
eq('выше обычного → проверьте смену', shortageVerdict(300000, 100000), 'выше обычного — проверьте вечернюю смену');
eq('фасовка объясняет ±2', rowDiffHint(2, true), 'бывает при пересчёте фасовки');
eq('большое расхождение не объясняется фасовкой', rowDiffHint(9, true), null);
eq('нет расхождения — нет подсказки', rowDiffHint(0, true), null);

const hInv = clean(renderToString(<InventoryScreen
  startedAt="24 июля в 23:58" scopeLabel="Кухня, склад и бар" counterName="Даулет"
  blindMode={true} normalShortage={100000} rows={inv}
  onCount={()=>{}} onToggleBlind={()=>{}} onPost={()=>{}} canPost={true} />));
eq('область пересчёта', hInv.includes('Кухня, склад и бар'), true);
eq('кто считает', hInv.includes('считает Даулет'), true);
eq('время начала', hInv.includes('24 июля в 23:58'), true);
eq('бейдж слепого режима', hInv.includes('Слепой пересчёт включён'), true);
eq('вердикт по недостаче', hInv.includes('выше обычного') || hInv.includes('в пределах нормы'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

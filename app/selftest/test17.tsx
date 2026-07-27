import React from 'react';
import { renderToString } from 'react-dom/server';
import { priceDeviation, supplyRowSum, supplyDocTotals, invRowDiff, invTotals,
  sortByMoneyImpact, SupplyScreen, InventoryScreen } from './stockscreens.tsx';
import type { SupplyRow, InvRow } from './stockscreens.tsx';

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

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

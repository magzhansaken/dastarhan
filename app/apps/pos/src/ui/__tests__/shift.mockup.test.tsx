import React from 'react';
import { renderToString } from 'react-dom/server';
import { ShiftOpenScreen, ShiftCloseScreen, ST, st, FLOAT_PRESETS,
  expectedCash, shiftDiff, diffCaption, diffHint, closeButtonLabel } from './shift.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

// словарь
eq('словарь смен двуязычен', Object.keys(ST).filter(k=>!(ST as any)[k].ru||!(ST as any)[k].kk), []);
eq('вопрос из макета', st('openQ','ru'), 'Сколько денег в ящике на старте?');
eq('подсказка про размен', st('openHint','ru').includes('с него даёте сдачу'), true);
eq('«Должно быть в ящике»', st('expected','ru'), 'Должно быть в ящике');
eq('«Фактически в ящике»', st('countedLbl','ru'), 'Фактически в ящике');
eq('kk: Ауысымды жабу', st('closeTitle','kk'), 'Ауысымды жабу');

// пресеты размена с подсказками — из макета
eq('три пресета', FLOAT_PRESETS.length, 3);
eq('40 000 — обычный размен', FLOAT_PRESETS[1].note.ru, 'обычный размен');
eq('20 000 — мало для вечера', FLOAT_PRESETS[0].note.ru, 'мало для вечера');
eq('60 000 — если много наличных', FLOAT_PRESETS[2].note.ru, 'если много наличных');

// расчёт закрытия — формула макета
const inp = { openingFloat:4000000, cashRevenue:38500000, courierHandover:1200000,
              cashRefunds:250000, collections:0 };
eq('должно быть в ящике', expectedCash(inp), 4000000+38500000+1200000-250000);
eq('сошлось → 0', shiftDiff(expectedCash(inp), inp), 0);
eq('излишек +5 000', shiftDiff(expectedCash(inp)+500000, inp), 500000);
eq('недостача −3 000', shiftDiff(expectedCash(inp)-300000, inp), -300000);
eq('инкассация вычитается', expectedCash({...inp, collections:21000000}), expectedCash(inp)-21000000);

// подписи расхождения
eq('ноль → «Расхождение»', diffCaption(0,'ru'), 'Расхождение');
eq('плюс → «Излишек»', diffCaption(500000,'ru'), 'Излишек');
eq('минус → «Недостача»', diffCaption(-500000,'ru'), 'Недостача');
eq('kk недостача', diffCaption(-1,'kk'), 'Жетіспеушілік');

// подсказки и кнопка
eq('до ввода — подсказка ввести', diffHint(null,0,'ru'), 'Введите сумму — расхождение посчитаем сами.');
eq('сошлось — точный текст макета', diffHint(100,0,'ru'), 'Всё сходится. Можно закрывать смену и снимать Z-отчёт.');
eq('кнопка без расхождения', closeButtonLabel(100,0,'ru'), 'Закрыть смену · Z-отчёт');
eq('кнопка с расхождением меняется', closeButtonLabel(100,-500,'ru'), 'Закрыть с расхождением');

// ═══ РЕНДЕР: ОТКРЫТИЕ ═══
const hOpen = clean(renderToString(<ShiftOpenScreen
  cashierName="Айгерим" time="08:14" prevShiftDate="23 июля"
  prevShiftOk fiscalReady stopListNote="манты и казы — кухня отметила вчера"
  lastCollection={{amount:21000000, note:'Забрал Ербол в 23:40. Подтверждено в бэк-офисе.'}}
  onOpen={()=>{}} />));
eq('заголовок открытия', hOpen.includes('Открытие смены'), true);
eq('кассир и время', hOpen.includes('Айгерим') && hOpen.includes('08:14'), true);
eq('вопрос о ящике', hOpen.includes('Сколько денег в ящике на старте'), true);
eq('пресеты с подсказками', hOpen.includes('обычный размен') && hOpen.includes('мало для вечера'), true);
eq('прошлая смена без расхождений', hOpen.includes('закрыта без расхождений'), true);
eq('Webkassa на связи (текст макета)', hOpen.includes('Webkassa на связи'), true);
eq('стоп-лист с кухни', hOpen.includes('манты и казы'), true);
eq('инкассация вчера с суммой', hOpen.includes('Инкассация вчера') && hOpen.includes('210 000'), true);
eq('кнопка с суммой размена', hOpen.includes('Открыть смену') && hOpen.includes('40 000'), true);

// ═══ РЕНДЕР: ЗАКРЫТИЕ ═══
const hClose = clean(renderToString(<ShiftCloseScreen
  shiftRange="08:14 — 23:52" cashierName="Айгерим" checksCount={142}
  input={inp}
  notes={{ openingFloat:'внесла Айгерим в 08:14', cashRevenue:'58 чеков наличными',
           courierHandover:'Даулет сдал в 21:10', cashRefunds:'1 возврат, стол 5' }}
  onClose={()=>{}} />));
eq('шапка закрытия', hClose.includes('08:14 — 23:52') && hClose.includes('142 чека'), true);
eq('«Что система насчитала»', hClose.includes('Что система насчитала'), true);
eq('все пять строк расчёта', ['Размен на старте','Наличная выручка','Сдача курьерам','Возвраты наличными','Инкассация в смену'].every(x=>hClose.includes(x)), true);
eq('пояснения к строкам', hClose.includes('58 чеков наличными') && hClose.includes('Даулет сдал в 21:10'), true);
eq('инкассация «не проводилась»', hClose.includes('не проводилась'), true);
eq('«Должно быть в ящике» с суммой', hClose.includes('Должно быть в ящике') && hClose.includes('434 500'), true);
eq('«Пересчитайте и введите факт»', hClose.includes('Пересчитайте и введите факт'), true);
eq('кнопка «Пересчитать»', hClose.includes('Пересчитать'), true);
eq('подсказка до ввода', hClose.includes('расхождение посчитаем сами'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

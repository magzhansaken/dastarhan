import React from 'react';
import { renderToString } from 'react-dom/server';
import { ProfitScreen } from './repscreens.tsx';
import { PNL_LINES, PNL_VIEW, PNL_PERIODS, pctOfRevenue, pnlCellText } from './repvm.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

// строки P&L — состав из макета
eq('11 строк отчёта', PNL_LINES.length, 11);
eq('порядок статей из макета', PNL_LINES.map(l=>l.key),
  ['revenue','cogs','gross','salary','rent','utility','marketing','writeoff','other','tax','net']);
eq('«Выручка» — фискальные чеки, наличные и Kaspi', PNL_LINES[0].note, 'фискальные чеки, наличные и Kaspi');
eq('«Себестоимость блюд» по техкартам', PNL_LINES[1].note, 'по техкартам, фудкост');
eq('«Валовая прибыль» = выручка минус продукты', PNL_LINES[2].note, 'выручка минус продукты');
eq('«Коммунальные» — свет, вода, вывоз', PNL_LINES.find(l=>l.key==='utility')!.note, 'свет, вода, вывоз');
eq('«Маркетинг» — таргет и печать меню', PNL_LINES.find(l=>l.key==='marketing')!.note, 'таргет и печать меню');
eq('«Прочее» — хозтовары, ремонт, интернет', PNL_LINES.find(l=>l.key==='other')!.note, 'хозтовары, ремонт, интернет');
eq('налог 3% с пояснением про ИП', PNL_LINES.find(l=>l.key==='tax')!.note, 'ИП на упрощённом режиме, Казахстан');
eq('«Чистая прибыль» — то, что осталось у вас', PNL_LINES[10].note, 'то, что осталось у вас');
eq('валовая и чистая выделены жирным', PNL_LINES.filter(l=>l.strong).map(l=>l.key), ['gross','net']);
eq('расходы со знаком минус', PNL_LINES.filter(l=>l.sign===-1).length, 8);

// переключатели вида
eq('«Показать в % от выручки»', PNL_VIEW.inPct.ru, 'Показать в % от выручки');
eq('«Показать в тенге»', PNL_VIEW.inTenge.ru, 'Показать в тенге');
eq('«Выгрузить в Excel»', PNL_VIEW.exportXls.ru, 'Выгрузить в Excel');
eq('«Налог считается сам»', PNL_VIEW.taxAuto.ru, 'Налог считается сам');
eq('колонка «% выр.»', PNL_VIEW.colPct.ru, '% выр.');

// периоды и сравнения из макета
eq('три периода', PNL_PERIODS.length, 3);
eq('июль сравнивается с июнем', [PNL_PERIODS[0].title, PNL_PERIODS[0].compare], ['Июль','К июню']);
eq('подзаголовок июля', PNL_PERIODS[0].subtitle, 'Июль 2026 · 1–24 июля');
eq('июнь сравнивается с маем', PNL_PERIODS[1].compare, 'К маю');
eq('квартал: II квартал + июль', PNL_PERIODS[2].subtitle, 'II квартал + июль');
eq('квартал сравнивается с I кв.', PNL_PERIODS[2].compare, 'К I кв.');

// проценты от выручки
eq('30% от выручки', pctOfRevenue(3000000, 10000000), 30);
eq('минус тоже даёт положительный %', pctOfRevenue(-3000000, 10000000), 30);
eq('деление на ноль', pctOfRevenue(100, 0), 0);
const f = (n:number) => `${Math.trunc(n/100).toLocaleString('ru-RU').replace(/\u00A0/g,' ')} ₸`;
eq('режим денег', pnlCellText(3000000, 10000000, 'money', f), '30 000 ₸');
eq('режим процентов', pnlCellText(3000000, 10000000, 'pct', f), '30%');

// ═══ РЕНДЕР ═══
const vals = { revenue:48620000, cogs:14100000, gross:34520000, salary:12800000, rent:4500000,
  utility:1100000, marketing:900000, writeoff:3450000, other:800000, tax:1458600, net:9511400 };
const prev = { revenue:43250000, cogs:13200000, gross:30050000, salary:12400000, rent:4500000,
  utility:980000, marketing:1200000, writeoff:1600000, other:700000, tax:1297500, net:7372500 };
const h = clean(renderToString(<ProfitScreen values={vals} prevValues={prev} periodKey="month"
  foodcostPct={29} staffCount={9} rentNote="Абая 52, 140 м²" writeoffNote="вдвое выше обычного"
  onPeriod={()=>{}} onExport={()=>{}} locationName="Абая"
  insights={[{text:'Списания 34 500 ₸ — вдвое выше июня. Почти всё салаты вечерней смены.', link:true}]} />));
eq('подзаголовок периода', h.includes('Июль 2026 · 1–24 июля'), true);
eq('три кнопки периодов', h.includes('Июль') && h.includes('Июнь') && h.includes('Квартал'), true);
eq('переключатель ₸/%', h.includes('>₸<') && h.includes('>%<'), true);
eq('кнопка Excel', h.includes('Выгрузить в Excel'), true);
eq('колонка сравнения «К июню»', h.includes('К июню'), true);
eq('все 11 статей', PNL_LINES.every(l => h.includes(l.title)), true);
eq('фудкост подставлен в пояснение', h.includes('по техкартам, фудкост 29%'), true);
eq('число людей в зарплате', h.includes('9 человек'), true);
eq('заметка об аренде', h.includes('Абая 52, 140 м²'), true);
eq('заметка о списаниях', h.includes('вдвое выше обычного'), true);
eq('налог с пояснением про ИП', h.includes('ИП на упрощённом режиме, Казахстан'), true);
eq('дельты к прошлому периоду', h.includes('delta-up') || h.includes('delta-down'), true);
eq('подсказка про налог', h.includes('Налог считается сам'), true);
eq('выгрузка для бухгалтера', h.includes('Выгрузка для бухгалтера'), true);
eq('заголовки таблицы «Строка/Тенге»', h.includes('Строка') && h.includes('Тенге'), true);
eq('фильтр по точке', h.includes('Точка Абая'), true);
eq('блок «Что повлияло на прибыль»', h.includes('Что повлияло на прибыль'), true);
eq('инсайт про списания', h.includes('вдвое выше июня'), true);
eq('ссылка «Отчёт →»', h.includes('Отчёт →'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

import React from 'react';
import { renderToString } from 'react-dom/server';
import { delta, salesReport, filterChecks, checksSummary, pnlView, abcHint, salaryStatement } from './repvm.ts';
import type { SaleRow, CheckRow } from './repvm.ts';
import { SalesScreen, ChecksScreen, PnlScreen, CashFlowScreen, AbcScreen, SalaryScreen } from './repscreens.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const D=(d:string,h:number)=>new Date(`2026-07-${d}T${String(h).padStart(2,'0')}:30:00`);

// ═══ Продажи ═══
const cur: SaleRow[] = [
  { at:D('13',12), total:500000, waiterId:'w1', waiterName:'Ербол' },
  { at:D('13',12), total:300000, waiterId:'w1', waiterName:'Ербол' },
  { at:D('13',19), total:700000, waiterId:'w2', waiterName:'Айгерим' },
  { at:D('14',12), total:500000, waiterId:'w2', waiterName:'Айгерим' },
];
const prev: SaleRow[] = [{ at:D('06',12), total:1000000 }, { at:D('06',13), total:600000 }];
const r = salesReport(cur, prev);
eq('выручка 20000 vs 16000 = +25%', [r.revenue.value, r.revenue.diffPct], [2000000, 25]);
eq('чеки 4 vs 2 = +100%', [r.checks.value, r.checks.diffPct], [4, 100]);
eq('средний чек 5000 vs 8000 = −38%', [r.avg.value, r.avg.diffPct], [500000, -38]);
eq('час пик 12 (2 чека)', r.peakHour, 12);
eq('2 дня в динамике', r.byDay.length, 2);
eq('Айгерим первая (12000 > 8000)', r.byWaiter[0].name, 'Айгерим');
eq('деление на ноль в дельте', delta(100, 0).diffPct, null);

// ═══ Чеки ═══
const checks: CheckRow[] = [
  { orderId:'o1', number:1, closedAt:D('13',12), total:500000, paymentKinds:['CASH'], hasRemovedItems:false, fiscalStatus:'SENT' },
  { orderId:'o2', number:2, closedAt:D('13',13), total:300000, paymentKinds:['CARD'], hasRemovedItems:true, fiscalStatus:'SENT' },
  { orderId:'o3', number:3, closedAt:D('13',14), total:200000, paymentKinds:['CASH','CARD'], hasRemovedItems:false, fiscalStatus:'ERROR' },
];
eq('фильтр: только с удалениями', filterChecks(checks, {onlyWithRemoved:true}).map(c=>c.number), [2]);
eq('фильтр: фискальные проблемы', filterChecks(checks, {onlyFiscalProblems:true}).map(c=>c.number), [3]);
eq('фильтр: по типу оплаты CARD', filterChecks(checks, {paymentKind:'CARD'}).map(c=>c.number), [2,3]);
eq('поиск по номеру', filterChecks(checks, {search:'3'}).map(c=>c.number), [3]);
const cs = checksSummary(checks);
eq('сводка: 3 чека, 1 с удалением, 1 проблема', [cs.count, cs.withRemoved, cs.fiscalProblems], [3,1,1]);

// ═══ P&L ═══
const v = pnlView(
  { revenue:10_000_000, cogs:3_000_000, opex:4_000_000, tax:300_000, netProfit:2_700_000 },
  { revenue:8_000_000, cogs:2_800_000, opex:3_900_000, tax:240_000, netProfit:1_060_000 });
eq('валовая: 70000 vs 52000', [v.grossProfit.value, v.grossProfit.prevValue], [7_000_000, 5_200_000]);
eq('фудкост 30% vs 35%', [v.foodcostPct.cur, v.foodcostPct.prev], [30, 35]);
eq('прибыль +155%', v.netProfit.diffPct, 155);

// ═══ ABC подсказки ═══
eq('AA — звезда', abcHint({productId:'p',name:'x',revenueClass:'A',marginClass:'A'}).includes('Звезда'), true);
eq('AC — трафик-мейкер', abcHint({productId:'p',name:'x',revenueClass:'A',marginClass:'C'}).includes('трафик') || abcHint({productId:'p',name:'x',revenueClass:'A',marginClass:'C'}).includes('Трафик'), true);
eq('CA — жемчужина', abcHint({productId:'p',name:'x',revenueClass:'C',marginClass:'A'}).includes('жемчужина'), true);
eq('CC — балласт', abcHint({productId:'p',name:'x',revenueClass:'C',marginClass:'C'}).includes('Балласт'), true);

// ═══ Зарплата ═══
const sal = salaryStatement([
  { userId:'u1', name:'Айгерим', role:'Кассир', baseSalary:15_000_000, hourly:0, salesPct:2_000_000, advances:5_000_000 },
  { userId:'u2', name:'Ербол', role:'Официант', baseSalary:0, hourly:12_000_000, salesPct:3_000_000, advances:0 },
]);
eq('Айгерим к выплате 120000', sal.rows.find(r=>r.userId==='u1')!.toPay, 12_000_000);
eq('Ербол первый (150000 > 120000)', sal.rows[0].userId, 'u2');
eq('итого к выплате 270000', sal.totalToPay, 27_000_000);

// ═══ ЖИВОЙ РЕНДЕР ВСЕХ ШЕСТИ ═══
const h1 = clean(renderToString(<SalesScreen cur={cur} prev={prev} />));
eq('продажи: вопрос владельца', h1.includes('Сколько я заработал'), true);
eq('продажи: дельта ↑25%', h1.includes('↑25%'), true);
eq('продажи: час пик 12:00', h1.includes('12:00'), true);

const h2 = clean(renderToString(<ChecksScreen rows={checks} />));
eq('чеки: сводка проблем', h2.includes('с удалениями: 1') && h2.includes('проблемы фискализации: 1'), true);
eq('чеки: строка с удалением подсвечена', h2.includes('row-warn'), true);

const h3 = clean(renderToString(<PnlScreen
  cur={{revenue:10_000_000, cogs:3_000_000, opex:4_000_000, tax:300_000, netProfit:2_700_000}}
  prev={{revenue:8_000_000, cogs:2_800_000, opex:3_900_000, tax:240_000, netProfit:1_060_000}} />));
eq('P&L: строка налога 3%', h3.includes('упрощёнка 3%'), true);
eq('P&L: фудкост в строке себестоимости', h3.includes('фудкост 30%'), true);
eq('P&L: прибыль после налога', h3.includes('после налога'), true);

const h4 = clean(renderToString(<CashFlowScreen inflow={9_000_000} outflow={7_000_000}
  byCategory={[{name:'Аренда', amount:2_000_000, direction:'out'},{name:'Выручка', amount:9_000_000, direction:'in'}]} />));
eq('CF: вопрос «Куда ушли деньги?»', h4.includes('Куда ушли деньги'), true);
eq('CF: категории отсортированы (выручка первой)', h4.indexOf('Выручка') < h4.indexOf('Аренда'), true);

const h5 = clean(renderToString(<AbcScreen rows={[
  {productId:'plov',name:'Плов',revenueClass:'A',marginClass:'C'},
  {productId:'tea',name:'Чай',revenueClass:'C',marginClass:'A'}]} />));
eq('ABC: колонка «Что делать»', h5.includes('Что делать'), true);
eq('ABC: подсказка про цену у плова', h5.includes('поднимите цену'), true);

const h6 = clean(renderToString(<SalaryScreen periodLabel="Июль 2026" rows={[
  { userId:'u1', name:'Айгерим', role:'Кассир', baseSalary:15_000_000, hourly:0, salesPct:2_000_000, advances:5_000_000 }]} />));
eq('зарплата: колонки разбивки', ['Оклад','Часы','% продаж','Авансы','К выплате'].every(c=>h6.includes(c)), true);
eq('зарплата: к выплате 120 000', h6.includes('120 000'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

import { pnl, cashFlow, abc, rfm, pickRule, minutesWorked, accrual } from '../finance.logic.ts';
import type { FinTx } from '../finance.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};

// ═══ P&L: кафе за месяц (тиыны) ═══
// выручка 3 000 000 тг, себестоимость 1 050 000 (35%), аренда 400к, ФОТ 600к
const p = pnl({
  revenue: 300_000_000, cogs: 105_000_000,
  expensesByCat: [{name:'Аренда', amount:40_000_000},{name:'ФОТ', amount:60_000_000}],
  taxRegime: { type:'simplified_3pct' },
});
eq('валовая прибыль', p.grossProfit, 195_000_000);
eq('маржа 65%', p.grossMarginPct, 65);
eq('операционная', p.operatingProfit, 95_000_000);
eq('налог 3% с оборота (КЗ упрощёнка)', p.tax, 9_000_000);
eq('чистая прибыль', p.netProfit, 86_000_000);

// ═══ Cash Flow: остатки счетов, переводы не искажают ═══
const opening = new Map([['cash', 5_000_000], ['kaspi', 0]]);
const txs: FinTx[] = [
  { finAccountId:'cash', kind:'INCOME', amount:200_000_000, category:'Выручка' },
  { finAccountId:'kaspi', kind:'INCOME', amount:90_000_000, category:'Выручка' },
  { finAccountId:'cash', kind:'EXPENSE', amount:70_000_000, category:'Закупка' },
  // инкассация: перевод кассы в банк — НЕ доход и НЕ расход
  { finAccountId:'cash', toFinAccountId:'bank', kind:'TRANSFER', amount:100_000_000, category:'Инкассация' },
];
const cf = cashFlow(opening, txs);
eq('приток без переводов', cf.inflow, 290_000_000);
eq('отток без переводов', cf.outflow, 70_000_000);
eq('остаток кассы', cf.accountBalances.get('cash'), 5_000_000+200_000_000-70_000_000-100_000_000);
eq('банк получил перевод', cf.accountBalances.get('bank'), 100_000_000);
eq('категории без инкассации', cf.byCategory.map(c=>c.category).includes('Инкассация'), false);

// ═══ P&L ≠ CF объяснимо (методичка Poster) ═══
// продали на 290, но закупку 70 оплатили лишь частично (долг 35) →
// CF-расход 70, а COGS в P&L мог быть 105 → расхождение = долг поставщику.
const cogsAccrual = 105_000_000, paidToSuppliers = 70_000_000;
eq('расхождение = долг поставщикам', cogsAccrual - paidToSuppliers, 35_000_000);

// ═══ ABC: 80/15/5 по кумулятивной доле ═══
const cls = abc([
  {productId:'plov', value:500}, {productId:'manty', value:300},
  {productId:'tea', value:120}, {productId:'salad', value:50}, {productId:'gum', value:30},
]);
eq('плов = A', cls.get('plov'), 'A');
eq('манты = A (кумулятивно 80%)', cls.get('manty'), 'A');
eq('чай = B', cls.get('tea'), 'B');
eq('жвачка = C', cls.get('gum'), 'C');

// ═══ RFM-сегменты (QuickResto) ═══
eq('частый свежий = Чемпион', rfm({daysSinceLast:10, ordersCount:8, totalSpent:500_000_00}).segment, 'Чемпионы');
eq('свежий редкий = Новичок', rfm({daysSinceLast:5, ordersCount:1, totalSpent:10_000_00}).segment, 'Новички');
eq('давно и часто = Уходящие', rfm({daysSinceLast:200, ordersCount:6, totalSpent:300_000_00}).segment, 'Уходящие');
eq('давно и редко = Спящие', rfm({daysSinceLast:400, ordersCount:1, totalSpent:5_000_00}).segment, 'Спящие');

// ═══ Зарплата: официант — час + % продаж; переопределение ═══
const roleRule = { monthlyBase:0, hourlyRate:50_000, salesPct:1 }; // 500тг/час + 1%
const userRule = { monthlyBase:0, hourlyRate:60_000, salesPct:1.5 };
eq('правило сотрудника приоритетнее', pickRule(roleRule, userRule).hourlyRate, 60_000);
eq('без переопределения — роль', pickRule(roleRule, undefined).hourlyRate, 50_000);

const mins = minutesWorked([
  { clockIn: new Date('2026-07-01T09:00Z'), clockOut: new Date('2026-07-01T18:30Z') }, // 570
  { clockIn: new Date('2026-07-02T09:00Z'), clockOut: new Date('2026-07-02T18:00Z'), adjustedMinutes: 480 }, // коррекция
  { clockIn: new Date('2026-07-03T09:00Z') }, // незакрытая — не считается
]);
eq('минуты: 570 + 480 скорректированных', mins, 1050);

const a = accrual(userRule, 1050, 80_000_000, 30, 0);
eq('почасовка 17.5ч × 600тг', a.hourly, Math.round(1050/60*60_000));
eq('процент 1.5% от 800 000тг', a.sales, 1_200_000);
eq('итог = час + продажи', a.total, a.hourly + a.sales);

// оклад пропорционально: менеджер 300 000тг, отработал 15 из 30 дней
const m = accrual({monthlyBase:30_000_000, hourlyRate:0, salesPct:0}, 0, 0, 30, 0.5);
eq('оклад за полмесяца', m.base, 15_000_000);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

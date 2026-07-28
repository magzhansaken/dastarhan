// Бухгалтерские расчёты
// НДС «в том числе»: сумма уже включает налог
const vatIncluded = (total, rate) => Math.round(total * rate / (100 + rate));
// Налог с оборота начисляется сверху выручки
const turnoverTax = (revenue, rate) => Math.round(revenue * rate / 100);
const netRevenue = (revenue, refunds) => revenue - refunds;
// Оборотно-сальдовая: остаток на начало = конец - приход + расход
const startBalance = (end, inQty, outQty) => +(end - inQty + outQty).toFixed(3);

function quarterDeadline(month, year) {
  const q = Math.floor(month/3) + 1;
  const end = new Date(Date.UTC(year, q*3, 0));
  const pay = new Date(end);
  pay.setUTCDate(pay.getUTCDate() + 25);
  return { quarter: q, payBy: pay.toISOString().slice(0,10) };
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Чек 11 600 ₸ с НДС 16% включённым
eq('НДС в том числе из 11 600', vatIncluded(1160000, 16), 160000);
eq('НДС из 100 000 при 16%', vatIncluded(10000000, 16), 1379310);

// Упрощёнка 3% с оборота
eq('налог 3% с 500 000', turnoverTax(50000000, 3), 1500000);
eq('налог с нулевой выручки', turnoverTax(0, 3), 0);

// Возвраты уменьшают базу
eq('выручка минус возвраты', netRevenue(50000000, 2000000), 48000000);
eq('налог считается с чистой',
  turnoverTax(netRevenue(50000000, 2000000), 3), 1440000);

// Оборотка: было 5, пришло 20, ушло 18, осталось 7
eq('остаток на начало', startBalance(7, 20, 18), 5);
eq('без движений остаток тот же', startBalance(10, 0, 0), 10);

// Сроки: июль это третий квартал, платить до 25 октября
eq('июль — третий квартал', quarterDeadline(6, 2026).quarter, 3);
eq('срок оплаты за третий квартал', quarterDeadline(6, 2026).payBy, '2026-10-25');
eq('январь — первый квартал', quarterDeadline(0, 2026).quarter, 1);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

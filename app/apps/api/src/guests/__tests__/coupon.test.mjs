// Расчёт скидки по купону и проверки
const calc = (kind, value, total) =>
  kind === 'PERCENT' ? Math.round(total*value/100) :
  kind === 'AMOUNT'  ? Math.min(value, total) : 0;

function check(c, total, usedByGuest) {
  const now = new Date('2026-07-28');
  if (!c.isActive) return { valid:false, reason:'Акция отключена' };
  if (c.endsAt && new Date(c.endsAt) < now) return { valid:false, reason:'закончилась' };
  if (c.maxUses && c.usedCount >= c.maxUses) return { valid:false, reason:'лимит исчерпан' };
  if (total < c.minTotal) return { valid:false, reason:'мал чек' };
  if (c.perGuest && usedByGuest >= c.perGuest) return { valid:false, reason:'гость использовал' };
  return { valid:true, discount: calc(c.kind, c.value, total) };
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

eq('20% от 10 000 = 2 000', calc('PERCENT',20,1000000), 200000);
eq('фикс 500 от 10 000', calc('AMOUNT',50000,1000000), 50000);
eq('фикс больше чека — не уходим в минус', calc('AMOUNT',200000,100000), 100000);

const base = { isActive:true, kind:'PERCENT', value:20, minTotal:500000, maxUses:100, usedCount:5, perGuest:1 };
eq('чек проходит порог', check(base, 1000000, 0).valid, true);
eq('мал чек — отказ', check(base, 300000, 0).valid, false);
eq('лимит исчерпан', check({...base, usedCount:100}, 1000000, 0).valid, false);
eq('гость уже использовал', check(base, 1000000, 1).valid, false);
eq('акция отключена', check({...base, isActive:false}, 1000000, 0).valid, false);
eq('акция кончилась', check({...base, endsAt:'2026-07-01'}, 1000000, 0).valid, false);

// окупаемость
const ratio = (given, earned) => given > 0 ? +(earned/given).toFixed(1) : null;
eq('скидка 200к дала выручку 1млн → 5x', ratio(200000, 1000000), 5);
eq('без использований — нет данных', ratio(0, 0), null);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

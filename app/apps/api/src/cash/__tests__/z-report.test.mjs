// Z-отчёт: ожидаемая наличность и вердикт
const expected = (opening, cash, cashIn, cashOut) => opening + cash + cashIn - Math.abs(cashOut);
const diff = (counted, exp) => counted - exp;
const perHour = (revenue, hours) => hours > 0 ? Math.round(revenue/hours) : 0;
function median(nums) {
  const s = [...nums].sort((a,b)=>a-b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length-1)/2] : Math.round((s[s.length/2-1]+s[s.length/2])/2);
}
function verdict(diffPct, removals) {
  if (removals >= 15) return 'много удалений';
  if (diffPct === null) return 'закрыта';
  if (diffPct >= 20) return 'хорошая смена';
  if (diffPct <= -25) return 'разберитесь';
  return 'обычная';
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Размен 40 000, наличными 180 000, внесли 5 000, изъяли 50 000
eq('ожидаемая наличность',
  expected(4000000, 18000000, 500000, 5000000), 17500000);
eq('без движений', expected(4000000, 18000000, 0, 0), 22000000);

eq('касса сошлась', diff(17500000, 17500000), 0);
eq('недостача 2 000', diff(17300000, 17500000), -200000);
eq('излишек 500', diff(17550000, 17500000), 50000);

eq('выручка в час', perHour(48000000, 12), 4000000);
eq('короткая смена', perHour(12000000, 4), 3000000);

// Медиана устойчива к банкету
eq('обычный вторник', median([38000000, 42000000, 40000000]), 40000000);
eq('банкет не задирает норму',
  median([38000000, 42000000, 40000000, 150000000]), 41000000);

eq('выше обычного на 25%', verdict(25, 3), 'хорошая смена');
eq('провал', verdict(-30, 3), 'разберитесь');
eq('норма', verdict(5, 3), 'обычная');
eq('удаления важнее выручки', verdict(30, 20), 'много удалений');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

// Уровень фудкоста и цвет плашки
const level = (pct) => pct <= 30 ? 'ok' : pct <= 40 ? 'warn' : 'danger';
const foodCost = (cost, price) => price > 0 ? +((cost/price)*100).toFixed(1) : 0;
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('плов 474₸ при цене 2500 = 19%', foodCost(47400, 250000), 19);
eq('19% — зелёный', level(19), 'ok');
eq('32% — жёлтый', level(32), 'warn');
eq('45% — красный', level(45), 'danger');
eq('ровно 30 — ещё зелёный', level(30), 'ok');
eq('ровно 40 — ещё жёлтый', level(40), 'warn');
eq('без цены — ноль', foodCost(50000, 0), 0);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

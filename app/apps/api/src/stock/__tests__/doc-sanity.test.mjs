// Проверка правдоподобности количеств в накладной
function check(qty, unit, unitCost, isIncome) {
  const w = [];
  const limit = unit === 'KG' ? 1000 : unit === 'L' ? 1000 : 10000;
  if (qty > limit) w.push('UNITS');
  if (unitCost === 0 && isIncome) w.push('NO_PRICE');
  return w;
}
let p=0,f=0;
const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

eq('20 кг риса — норма', check(20,'KG',60000,true), []);
eq('20 000 кг — подозрение на граммы', check(20000,'KG',60,true), ['UNITS','NO_PRICE'].slice(0,1).concat([]) );
eq('500 кг муки проходит', check(500,'KG',20000,true), []);
eq('1 200 кг — просим подтвердить', check(1200,'KG',20000,true), ['UNITS']);
eq('приход без цены — предупреждение', check(10,'KG',0,true), ['NO_PRICE']);
eq('списание без цены — норма', check(10,'KG',0,false), []);
eq('5 000 штук стаканов — норма', check(5000,'PCS',500,true), []);
eq('50 000 штук — подозрение', check(50000,'PCS',500,true), ['UNITS']);
console.log(`\nИТОГ: ${p} прошло, ${f} упало`); process.exit(f?1:0);

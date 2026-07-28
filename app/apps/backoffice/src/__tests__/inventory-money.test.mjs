const inventoryMoneyDiff=(l)=>Math.round(l.reduce((s,x)=>s+x.diff*x.avgCost,0));
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('недостача 2 кг говядины', inventoryMoneyDiff([{diff:-2,avgCost:280000}]), -560000);
eq('излишек и недостача', inventoryMoneyDiff([{diff:-2,avgCost:280000},{diff:1,avgCost:60000}]), -500000);
eq('всё сошлось', inventoryMoneyDiff([{diff:0,avgCost:280000}]), 0);
eq('дробные килограммы', inventoryMoneyDiff([{diff:-0.35,avgCost:280000}]), -98000);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

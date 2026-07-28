// Скользящая средневзвешенная при проведении прихода
function applySupply(curQty, curAvg, inQty, inCost) {
  const avg = curQty <= 0 ? inCost : Math.round((curQty*curAvg + inQty*inCost)/(curQty+inQty));
  return { qty: curQty + inQty, avgCost: avg };
}
let p=0,f=0;
const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

eq('первый приход задаёт среднюю', applySupply(0,0,10,50000), {qty:10, avgCost:50000});
eq('второй усредняет', applySupply(10,50000,10,70000), {qty:20, avgCost:60000});
eq('минус сбрасывает среднюю на цену прихода', applySupply(-5,99999,10,50000), {qty:5, avgCost:50000});
eq('дорогой приход тянет среднюю вверх', applySupply(90,10000,10,110000).avgCost, 20000);
eq('приход на минус выводит в плюс', applySupply(-125,0,200,30000).qty, 75);
console.log(`\nИТОГ: ${p} прошло, ${f} упало`); process.exit(f?1:0);

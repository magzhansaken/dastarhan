// Производство полуфабрикатов
const factor = (qty, output) => qty / output;
function needed(lines, f) {
  return lines.map(l => ({ id: l.componentId, qty: +(l.bruttoQty*f).toFixed(3) }));
}
function canProduce(need, stock) {
  return need.filter(n => (stock[n.id] ?? 0) < n.qty).map(n => n.id);
}
const cost = (need, prices) => need.reduce((s,n) => s + n.qty*(prices[n.id]??0), 0);
const unitCost = (total, qty) => Math.round(total/qty);
// Скользящая средняя при оприходовании
const nextAvg = (curQty, curAvg, addQty, addCost) =>
  curQty <= 0 ? Math.round(addCost/addQty)
  : Math.round((curQty*curAvg + addCost)/(curQty+addQty));

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

// Зирвак: техкарта на 10 кг из моркови 4 кг + масла 1 кг
const card = { outputQty: 10, lines: [
  { componentId:'carrot', bruttoQty: 4 },
  { componentId:'oil',    bruttoQty: 1 },
]};

eq('варим 10 кг — коэффициент 1', factor(10, 10), 1);
eq('варим 5 кг — половина', factor(5, 10), 0.5);
eq('варим 25 кг — 2.5 партии', factor(25, 10), 2.5);

eq('на 5 кг нужно 2 кг моркови',
  needed(card.lines, 0.5), [{id:'carrot',qty:2},{id:'oil',qty:0.5}]);

eq('сырья хватает', canProduce(needed(card.lines,1), {carrot:10, oil:3}), []);
eq('не хватает масла', canProduce(needed(card.lines,1), {carrot:10, oil:0.5}), ['oil']);
eq('пустой склад — всё не хватает',
  canProduce(needed(card.lines,1), {}), ['carrot','oil']);

// Морковь 350 ₸/кг, масло 900 ₸/кг
const prices = { carrot: 35000, oil: 90000 };
eq('себестоимость 10 кг зирвака', cost(needed(card.lines,1), prices), 230000);
eq('за килограмм', unitCost(230000, 10), 23000);

eq('первая партия — своя цена', nextAvg(0, 0, 10, 230000), 23000);
eq('вторая дороже — средняя растёт', nextAvg(10, 23000, 10, 270000), 25000);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

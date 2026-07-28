// Перемещения с приёмкой
const enough = (have, need) => have >= need;
const isFull = (sent, got) => got >= sent*0.99;
const loss = (sent, got, cost) => Math.round((sent-got)*cost);
const isStale = (hours) => hours > 24;
function status(lines) {
  return lines.every(l => isFull(l.sent, l.got)) ? 'RECEIVED' : 'PARTIAL';
}
const nextAvg = (curQty, curAvg, addQty, addCost) =>
  curQty <= 0 ? addCost : Math.round((curQty*curAvg + addQty*addCost)/(curQty+addQty));

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

eq('хватает на отправку', enough(15, 10), true);
eq('не хватает', enough(8, 10), false);
eq('ровно столько', enough(10, 10), true);

eq('доехало полностью', isFull(10, 10), true);
eq('погрешность 0.5% — норма', isFull(10, 9.95), true);
eq('недостача 10%', isFull(10, 9), false);

// Конина 2800 ₸/кг, потеряли 1 кг
eq('недостача в деньгах', loss(10, 9, 280000), 280000);
eq('без недостачи — ноль', loss(10, 10, 280000), 0);

eq('всё доехало — принято', status([{sent:10,got:10},{sent:5,got:5}]), 'RECEIVED');
eq('одна позиция с недостачей', status([{sent:10,got:9},{sent:5,got:5}]), 'PARTIAL');

eq('в пути 3 часа — норма', isStale(3), false);
eq('в пути двое суток — тревога', isStale(48), true);

// Приход на второй склад
eq('пустой склад — цена отправителя', nextAvg(0, 0, 10, 280000), 280000);
eq('смешивание партий', nextAvg(10, 250000, 10, 290000), 270000);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

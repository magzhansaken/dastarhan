// Автостоп по остаткам и техкартам
function portionsLeft(lines, stock) {
  let min = Infinity, scarce = null;
  for (const l of lines) {
    if (l.bruttoQty <= 0) continue;
    const have = stock[l.componentId] ?? 0;
    const p = Math.floor(have / l.bruttoQty);
    if (p < min) { min = p; scarce = l.componentId; }
  }
  return { portions: min === Infinity ? null : Math.max(0, min), scarce };
}
function availability(card, stock, manual) {
  if (manual && manual.remainingQty === null) return { available:false, source:'manual' };
  if (!card) return { available:true, portions:null, source:'no_card' };
  const { portions, scarce } = portionsLeft(card.lines, stock);
  const limit = manual?.remainingQty ?? null;
  const final = limit !== null ? Math.min(limit, portions ?? limit) : portions;
  return {
    available: final === null || final > 0,
    portions: final, scarce,
    warning: final !== null && final > 0 && final <= 3,
    source: limit !== null ? 'manual_limit' : 'auto',
  };
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

const plov = { lines:[
  { componentId:'rice', bruttoQty:0.12 },
  { componentId:'beef', bruttoQty:0.125 },
]};

eq('хватает на 12 порций', availability(plov, {rice:20, beef:1.5}, null).portions, 12);
eq('дефицит — говядина', availability(plov, {rice:20, beef:1.5}, null).scarce, 'beef');
eq('кончилось — недоступно', availability(plov, {rice:20, beef:0}, null).available, false);
eq('три порции — предупреждение', availability(plov, {rice:20, beef:0.4}, null).warning, true);
eq('десять порций — без тревоги', availability(plov, {rice:20, beef:1.3}, null).warning, false);

eq('ручной стоп сильнее склада',
  availability(plov, {rice:20, beef:10}, {remainingQty:null}).available, false);
eq('ручной лимит ограничивает',
  availability(plov, {rice:20, beef:10}, {remainingQty:5}).portions, 5);
eq('склад ограничивает сильнее лимита',
  availability(plov, {rice:20, beef:0.25}, {remainingQty:10}).portions, 2);
eq('без техкарты всегда доступно',
  availability(null, {}, null).available, true);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

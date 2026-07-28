// Проверка разбивки счёта
function validateSplit(allItems, parts) {
  const assigned = parts.flatMap(p => p.itemIds);
  const missing = allItems.filter(id => !assigned.includes(id));
  const dup = new Set(assigned).size !== assigned.length;
  return { ok: !missing.length && !dup && parts.length >= 2, missing, dup };
}
const sumOf = (items, ids) => items.filter(i => ids.includes(i.id))
  .reduce((s, i) => s + i.qty * i.price, 0);

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

const items = [
  { id:'a', name:'Бешбармак', qty:1, price:280000 },
  { id:'b', name:'Чай',       qty:2, price:50000  },
  { id:'c', name:'Плов',      qty:1, price:250000 },
];

eq('корректная разбивка на двоих',
  validateSplit(['a','b','c'], [{itemIds:['a','b']},{itemIds:['c']}]).ok, true);

eq('забытая позиция ловится',
  validateSplit(['a','b','c'], [{itemIds:['a']},{itemIds:['c']}]).missing, ['b']);

eq('дубль позиции ловится',
  validateSplit(['a','b','c'], [{itemIds:['a','b']},{itemIds:['b','c']}]).dup, true);

eq('одна часть — не разбивка',
  validateSplit(['a','b','c'], [{itemIds:['a','b','c']}]).ok, false);

// суммы
eq('первая часть 380 000 ₸', sumOf(items, ['a','b']), 380000);
eq('вторая часть 250 000 ₸', sumOf(items, ['c']), 250000);
eq('сумма частей = целому',
  sumOf(items,['a','b']) + sumOf(items,['c']),
  items.reduce((s,i)=>s+i.qty*i.price,0));

// равные доли
const equal = (total, guests) => guests > 1 ? Math.round(total/guests) : total;
eq('поровну на троих', equal(630000, 3), 210000);
eq('один гость — вся сумма', equal(630000, 1), 630000);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

// Пять типов акций
function nPlusOne(items, cfg) {
  const n = cfg.n ?? 3, pay = cfg.pay ?? 2;
  let d = 0;
  for (const i of items) {
    if (cfg.productIds?.length && !cfg.productIds.includes(i.productId)) continue;
    const sets = Math.floor(i.qty / n);
    if (sets > 0) d += sets * (n - pay) * i.unitPrice;
  }
  return d;
}
function secondHalf(items, cfg) {
  const flat = [];
  for (const i of items) for (let k=0;k<i.qty;k++) flat.push(i.unitPrice);
  if (flat.length < 2) return 0;
  flat.sort((a,b)=>b-a);
  let d = 0;
  for (let k=1;k<flat.length;k+=2) d += Math.round(flat[k]*(cfg.percent??50)/100);
  return d;
}
function combo(items, cfg) {
  let sets = Infinity;
  for (const n of cfg.items) {
    const have = items.filter(i=>i.productId===n.productId).reduce((s,i)=>s+i.qty,0);
    sets = Math.min(sets, Math.floor(have/n.qty));
  }
  if (!sets || sets === Infinity) return 0;
  const full = cfg.items.reduce((s,n)=>{
    const it = items.find(i=>i.productId===n.productId);
    return s + (it?.unitPrice??0)*n.qty;
  },0);
  return Math.max(0,(full - cfg.price)*sets);
}
const happyHours = (h, dow, cfg) =>
  h >= (cfg.fromHour??15) && h < (cfg.toHour??17) && (cfg.days??[0,1,2,3,4]).includes(dow);

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// 3 по цене 2: кофе 500 ₸ × 6 штук
eq('шесть кофе = два бесплатных',
  nPlusOne([{productId:'c',qty:6,unitPrice:50000}], {n:3,pay:2}), 100000);
eq('два кофе — акция не сработала',
  nPlusOne([{productId:'c',qty:2,unitPrice:50000}], {n:3,pay:2}), 0);
eq('разные товары не складываются',
  nPlusOne([{productId:'c',qty:2,unitPrice:50000},{productId:'t',qty:2,unitPrice:30000}], {n:3,pay:2}), 0);

// Вторая за полцены: скидка на дешёвую
eq('скидка на дешёвую позицию',
  secondHalf([{productId:'a',qty:1,unitPrice:400000},{productId:'b',qty:1,unitPrice:200000}], {percent:50}),
  100000);
eq('одна позиция — нет скидки',
  secondHalf([{productId:'a',qty:1,unitPrice:400000}], {percent:50}), 0);
eq('четыре позиции — две со скидкой',
  secondHalf([{productId:'a',qty:4,unitPrice:100000}], {percent:50}), 100000);

// Комбо: суп+горячее+чай за 2500 вместо 3200
const comboCfg = { items:[{productId:'s',qty:1},{productId:'m',qty:1},{productId:'t',qty:1}], price:250000 };
eq('полный комбо даёт скидку',
  combo([{productId:'s',qty:1,unitPrice:80000},{productId:'m',qty:1,unitPrice:200000},{productId:'t',qty:1,unitPrice:40000}], comboCfg),
  70000);
eq('без чая комбо не собрано',
  combo([{productId:'s',qty:1,unitPrice:80000},{productId:'m',qty:1,unitPrice:200000}], comboCfg), 0);

// Счастливые часы
eq('вторник 16:00 — работает', happyHours(16, 1, {}), true);
eq('вторник 18:00 — поздно', happyHours(18, 1, {}), false);
eq('суббота 16:00 — выходной', happyHours(16, 5, {}), false);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

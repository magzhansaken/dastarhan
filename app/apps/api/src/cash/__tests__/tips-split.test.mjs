// Деление чаевых по долям
function split(total, shares) {
  const tw = shares.reduce((s,x)=>s+x.weight,0);
  let done = 0;
  return shares.map((s,i) => {
    const amount = i === shares.length-1 ? total - done : Math.round(total*s.weight/tw);
    done += amount;
    return { ...s, amount };
  });
}
const pctOfRevenue = (tips, revenue) => revenue > 0 ? +((tips/revenue)*100).toFixed(1) : 0;
const netTip = (amount, feePct) => amount - Math.round(amount*feePct/100);

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Котёл 45 000 ₸: два официанта 1.0, бармен 0.7, повар 0.5
const team = [
  { userId:'w1', weight:1 }, { userId:'w2', weight:1 },
  { userId:'b1', weight:0.7 }, { userId:'c1', weight:0.5 },
];
const res = split(4500000, team);
eq('сумма долей = котлу', res.reduce((s,r)=>s+r.amount,0), 4500000);
eq('официант получает больше бармена', res[0].amount > res[2].amount, true);
eq('повар получает меньше всех', res[3].amount < res[2].amount, true);

// Копейки не теряются при неровном делении
const odd = split(1000003, [{weight:1},{weight:1},{weight:1}]);
eq('остаток последнему', odd.reduce((s,r)=>s+r.amount,0), 1000003);

// Равные доли
const equal = split(3000000, [{weight:1},{weight:1},{weight:1}]);
eq('поровну на троих', equal[0].amount, 1000000);

// Доля от выручки
eq('чаевые 5% от выручки', pctOfRevenue(2500000, 50000000), 5);
eq('без выручки — ноль', pctOfRevenue(100000, 0), 0);

// Комиссия
eq('наличные без комиссии', netTip(500000, 0), 500000);
eq('перевод с комиссией 1%', netTip(500000, 1), 495000);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

// Прогноз выручки
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  return s.length%2 ? s[(s.length-1)/2] : Math.round((s[s.length/2-1]+s[s.length/2])/2);
}
const trendFactor = (oldSum, newSum) => {
  const t = oldSum > 0 ? newSum/oldSum : 1;
  return Math.min(1.5, Math.max(0.7, t));
};
const confidence = (vals) => {
  if (vals.length < 2) return 'low';
  const spread = ((Math.max(...vals)-Math.min(...vals))/(median(vals)||1))*100;
  return spread < 30 ? 'high' : spread < 60 ? 'medium' : 'low';
};
const staff = (checks) => Math.max(1, Math.ceil(checks/60));

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

eq('медиана ровных суббот', median([400000,420000,410000]), 410000);
eq('банкет не искажает', median([400000,420000,410000,1500000]), 415000);

eq('рост 20%', trendFactor(100, 120), 1.2);
eq('падение 15%', trendFactor(100, 85), 0.85);
eq('скачок втрое обрезается', trendFactor(100, 300), 1.5);
eq('обвал обрезается', trendFactor(100, 30), 0.7);

eq('стабильные субботы — доверяем', confidence([400000,420000,410000]), 'high');
eq('скачки вдвое — не доверяем', confidence([200000,400000,600000]), 'low');
eq('мало данных', confidence([400000]), 'low');

eq('60 чеков — один кассир', staff(60), 1);
eq('61 чек — двое', staff(61), 2);
eq('пустой день — всё равно один', staff(0), 1);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

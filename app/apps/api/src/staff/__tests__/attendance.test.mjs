// Явки: опоздания, округление, проблемы
const GRACE = 5, ROUND = 30;
const lateMin = (actual, plan) => Math.floor((actual - plan)/60000);
const isLate = (actual, plan) => lateMin(actual, plan) > GRACE;
const counted = (factMin) => Math.floor(factMin/ROUND)*ROUND;
function issues(factMin, planTo, checkOut) {
  const out = [];
  if (planTo) {
    const early = Math.floor((planTo - checkOut)/60000);
    if (early > GRACE) out.push(`Ранний уход на ${early} мин`);
  }
  if (factMin > 14*60) out.push('Больше 14 часов');
  return out;
}
const latePct = (late, days) => days > 0 ? Math.round((late/days)*100) : 0;

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

const plan = Date.UTC(2026,6,28,9,0);
const m = (n) => n*60000;

eq('пришёл вовремя', isLate(plan, plan), false);
eq('опоздал на 3 минуты — норма', isLate(plan+m(3), plan), false);
eq('опоздал на 20 минут', isLate(plan+m(20), plan), true);
eq('пришёл раньше', isLate(plan-m(10), plan), false);
eq('размер опоздания', lateMin(plan+m(25), plan), 25);

eq('3ч50м округляется до 3.5ч', counted(230), 210);
eq('ровно 4 часа', counted(240), 240);
eq('4ч29м → 4ч', counted(269), 240);
eq('20 минут не засчитываются', counted(20), 0);

const planEnd = Date.UTC(2026,6,28,18,0);
eq('ушёл вовремя', issues(480, planEnd, planEnd), []);
eq('ушёл на час раньше',
  issues(420, planEnd, planEnd-m(60)), ['Ранний уход на 60 мин']);
eq('забыл отметиться',
  issues(15*60, null, 0), ['Больше 14 часов']);

eq('три опоздания из тридцати — человек', latePct(3, 30), 10);
eq('десять из двенадцати — система', latePct(10, 12), 83);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

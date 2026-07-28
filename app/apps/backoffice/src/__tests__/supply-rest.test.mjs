const restAfter=(c,i)=>Number((c+i).toFixed(3));
function deferralUntil(from,days){const d=new Date(from);d.setDate(d.getDate()+days);return d;}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('остаток после прихода', restAfter(20, 200), 220);
eq('приход на минус', restAfter(-125, 200), 75);
eq('дробные килограммы', restAfter(16.67, 100), 116.67);
eq('отсрочка 7 дней', deferralUntil(new Date('2026-07-24'),7).toISOString().slice(0,10), '2026-07-31');
eq('отсрочка через месяц', deferralUntil(new Date('2026-07-28'),14).toISOString().slice(0,10), '2026-08-11');
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

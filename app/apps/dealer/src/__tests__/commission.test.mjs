const dealerEarned=(p,r)=>Math.round(p.reduce((s,x)=>s+x,0)*r/100);
function toNextTier(a,t){const n=t.filter(x=>x.min>a).sort((x,y)=>x.min-y.min)[0];
 return n?{need:n.min-a,nextRate:n.rate}:null;}
let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};
eq('комиссия 18% от 500к', dealerEarned([30000000,20000000],18), 9000000);
eq('нет платежей — нет комиссии', dealerEarned([],18), 0);
const tiers=[{min:5,rate:15},{min:15,rate:18},{min:30,rate:22}];
eq('до следующей ступени', toNextTier(12,tiers), {need:3,nextRate:18});
eq('на максимуме', toNextTier(35,tiers), null);
eq('новичок', toNextTier(0,tiers), {need:5,nextRate:15});
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

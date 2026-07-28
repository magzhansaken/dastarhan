const prorate=(p,dl,dm,d)=>dm<=0?0:Math.round(p*d*dl/dm);
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('точка добавлена за 10 дней до конца', prorate(1800000,10,31,1), 580645);
eq('точка убрана — возврат', prorate(1800000,10,31,-1), -580645);
eq('добавлена в первый день', prorate(1800000,31,31,1), 1800000);
eq('добавлена в последний день', prorate(1800000,1,31,1), 58065);
eq('две точки сразу', prorate(1800000,15,30,2), 1800000);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

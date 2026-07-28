const payrollTotal=(hr,h,pct,sales,adv)=>Math.round(hr*h+sales*pct/100-adv);
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('оклад 1500₸/ч × 180ч + 3% с 2млн − аванс 50к',
   payrollTotal(150000,180,3,200000000,5000000), 28000000);
eq('без процента', payrollTotal(150000,180,0,200000000,0), 27000000);
eq('аванс больше начисления даёт минус', payrollTotal(150000,10,0,0,5000000), -3500000);
eq('только процент', payrollTotal(0,0,5,100000000,0), 5000000);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

const conv = (jsDay) => (jsDay + 6) % 7;
let p=0,f=0; const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}≠${w}`))};
eq('воскресенье JS=0 → 6', conv(0), 6);
eq('понедельник JS=1 → 0', conv(1), 0);
eq('пятница JS=5 → 4', conv(5), 4);
eq('суббота JS=6 → 5', conv(6), 5);
console.log(`\nИТОГ: ${p} прошло, ${f} упало`); process.exit(f?1:0);

function checksLabel(n){const a=n%10,b=n%100;
 if(a===1&&b!==11)return `${n} чек`;
 if(a>=2&&a<=4&&(b<10||b>=20))return `${n} чека`;
 return `${n} чеков`;}
let p=0,f=0;const eq=(g,w)=>{g===w?(p++,console.log(`  ✓ ${g}`)):(f++,console.log(`  ✗ ${g}`))};
eq(checksLabel(142),'142 чека'); eq(checksLabel(1),'1 чек'); eq(checksLabel(11),'11 чеков');
eq(checksLabel(5),'5 чеков'); eq(checksLabel(21),'21 чек');
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

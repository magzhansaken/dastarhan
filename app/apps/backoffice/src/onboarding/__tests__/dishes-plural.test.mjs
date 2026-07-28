function dishesMore(n){const a=n%10,b=n%100;
 if(a===1&&b!==11)return `и ещё ${n} блюдо`;
 if(a>=2&&a<=4&&(b<10||b>=20))return `и ещё ${n} блюда`;
 return `и ещё ${n} блюд`;}
let p=0,f=0;const eq=(g,w)=>{g===w?(p++,console.log(`  ✓ ${g}`)):(f++,console.log(`  ✗ ${g} ≠ ${w}`))};
eq(dishesMore(61),'и ещё 61 блюдо'); eq(dishesMore(3),'и ещё 3 блюда');
eq(dishesMore(5),'и ещё 5 блюд'); eq(dishesMore(11),'и ещё 11 блюд');
eq(dishesMore(22),'и ещё 22 блюда'); eq(dishesMore(64),'и ещё 64 блюда');
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

function ordersLabel(n){const a=n%10,b=n%100;
 if(a===1&&b!==11)return `${n} заказ`;
 if(a>=2&&a<=4&&(b<10||b>=20))return `${n} заказа`;
 return `${n} заказов`;}
let p=0,f=0;const eq=(g,w)=>{g===w?(p++,console.log(`  ✓ ${g}`)):(f++,console.log(`  ✗ ${g} ≠ ${w}`))};
eq(ordersLabel(1),'1 заказ'); eq(ordersLabel(4),'4 заказа'); eq(ordersLabel(5),'5 заказов');
eq(ordersLabel(11),'11 заказов'); eq(ordersLabel(21),'21 заказ'); eq(ordersLabel(22),'22 заказа');
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

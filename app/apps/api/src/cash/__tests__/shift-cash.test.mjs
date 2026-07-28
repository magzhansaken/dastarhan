// Расчёт ожидаемой наличности и расхождения
const expected = (opening, cashRev, movements) => opening + cashRev + movements;
const diff = (actual, exp) => actual - exp;
const verdict = (d) => d === 0 ? 'Всё сошлось' : d > 0 ? 'Излишек' : 'Недостача';

let p=0,f=0;
const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

// Смена: размен 40 000, наличная выручка 385 000, инкассация −210 000
eq('ожидаемое = размен + выручка + движения', expected(4000000, 38500000, -21000000), 21500000);
eq('без движений', expected(4000000, 38500000, 0), 42500000);
eq('только размен на старте', expected(4000000, 0, 0), 4000000);

// расхождения
eq('сошлось', diff(21500000, 21500000), 0);
eq('излишек 500 ₸', diff(21550000, 21500000), 50000);
eq('недостача 300 ₸', diff(21470000, 21500000), -30000);

eq('вердикт при нуле', verdict(0), 'Всё сошлось');
eq('вердикт при плюсе', verdict(50000), 'Излишек');
eq('вердикт при минусе', verdict(-30000), 'Недостача');

// карточная выручка в ящик не попадает
const cashOnly = (payments) => payments.filter(x=>x.kind==='CASH').reduce((s,x)=>s+x.amount,0);
eq('карта не считается наличными', cashOnly([
  {kind:'CASH', amount:100000}, {kind:'CARD', amount:250000}, {kind:'KASPI_QR', amount:80000},
]), 100000);

console.log(`\nИТОГ: ${p} прошло, ${f} упало`); process.exit(f?1:0);

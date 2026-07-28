// Сверка с терминалом
function verdict(diff) {
  if (diff === null) return 'Введите итог с терминала';
  if (diff === 0) return 'Всё сошлось';
  if (Math.abs(diff) < 10000) return `в пределах округления`;
  return diff > 0 ? 'терминал больше' : 'система больше';
}
function suspects(payments) {
  const out = [];
  for (const p of payments) {
    if (p.status === 'CAPTURED' && p.orderStatus === 'CANCELLED')
      out.push({ kind:'cancelled_paid' });
    if (p.status === 'PENDING') out.push({ kind:'pending' });
  }
  const byOrder = new Map();
  for (const p of payments.filter(x=>x.status==='CAPTURED')) {
    const a = byOrder.get(p.orderId) ?? []; a.push(p.amount); byOrder.set(p.orderId, a);
  }
  for (const [, sums] of byOrder)
    if (sums.length > 1 && new Set(sums).size < sums.length) out.push({ kind:'possible_double' });
  return out;
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

eq('нет данных терминала', verdict(null), 'Введите итог с терминала');
eq('сошлось', verdict(0), 'Всё сошлось');
eq('50 ₸ — округление', verdict(5000), 'в пределах округления');
eq('терминал больше на 500 ₸', verdict(50000), 'терминал больше');
eq('система больше', verdict(-50000), 'система больше');

eq('отменённый с оплатой',
  suspects([{status:'CAPTURED',orderStatus:'CANCELLED',orderId:'a',amount:100}])[0].kind,
  'cancelled_paid');
eq('зависшая оплата',
  suspects([{status:'PENDING',orderId:'b',amount:100}])[0].kind, 'pending');
eq('двойное списание',
  suspects([
    {status:'CAPTURED',orderStatus:'CLOSED',orderId:'c',amount:500000},
    {status:'CAPTURED',orderStatus:'CLOSED',orderId:'c',amount:500000},
  ]).some(s=>s.kind==='possible_double'), true);
eq('разные суммы — не дубль',
  suspects([
    {status:'CAPTURED',orderStatus:'CLOSED',orderId:'d',amount:500000},
    {status:'CAPTURED',orderStatus:'CLOSED',orderId:'d',amount:200000},
  ]).length, 0);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

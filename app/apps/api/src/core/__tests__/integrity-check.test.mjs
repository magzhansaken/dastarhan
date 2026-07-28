// Проверка целостности данных
function check(data) {
  const issues = [];
  if (data.negativeStock > 0)
    issues.push({ level:'error', key:'negative_stock' });
  if (data.unpaidClosed > 0)
    issues.push({ level:'error', key:'unpaid_closed' });
  if (data.staleShifts > 0)
    issues.push({ level:'error', key:'stale_shifts' });
  if (data.dishesNoCard > 0)
    issues.push({ level:'warn', key:'no_techcard' });
  if (data.fiscalQueued > 10)
    issues.push({ level:'warn', key:'fiscal_queue' });
  return {
    healthy: issues.length === 0,
    errors: issues.filter(i=>i.level==='error').length,
    warnings: issues.filter(i=>i.level==='warn').length,
    verdict: issues.length === 0 ? 'Данные в порядке'
      : issues.some(i=>i.level==='error') ? 'Есть расхождения'
      : 'Есть замечания',
  };
}
const avgPerDay = (orders, days) => days > 0 ? Math.round(orders/days) : 0;

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

const clean = { negativeStock:0, unpaidClosed:0, staleShifts:0, dishesNoCard:0, fiscalQueued:0 };
eq('чистая база', check(clean).healthy, true);
eq('вердикт порядка', check(clean).verdict, 'Данные в порядке');

eq('минус на складе — ошибка', check({...clean, negativeStock:3}).errors, 1);
eq('чек без оплаты — ошибка', check({...clean, unpaidClosed:2}).errors, 1);
eq('смена сутки — ошибка', check({...clean, staleShifts:1}).errors, 1);

eq('нет техкарты — предупреждение', check({...clean, dishesNoCard:5}).warnings, 1);
eq('и это не ошибка', check({...clean, dishesNoCard:5}).errors, 0);

eq('очередь 5 чеков — норма', check({...clean, fiscalQueued:5}).warnings, 0);
eq('очередь 50 чеков — тревога', check({...clean, fiscalQueued:50}).warnings, 1);

eq('только замечания', check({...clean, dishesNoCard:3}).verdict, 'Есть замечания');
eq('ошибки важнее замечаний',
  check({...clean, negativeStock:1, dishesNoCard:3}).verdict, 'Есть расхождения');

eq('средний день', avgPerDay(4260, 30), 142);
eq('без истории — ноль', avgPerDay(0, 0), 0);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

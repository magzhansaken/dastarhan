// Расчёт зарплаты по трём схемам
function calc(rule, shifts, hours, sales, manual) {
  const lines = [];
  if (rule.salary > 0) lines.push({ kind:'SALARY', amount: rule.salary });
  if (rule.perShift > 0) lines.push({ kind:'SHIFT', amount: rule.perShift * shifts });
  if (rule.perHour > 0) lines.push({ kind:'HOURLY', amount: Math.round(rule.perHour * hours) });
  if (rule.salesPct > 0) lines.push({ kind:'SALES_PCT', amount: Math.round(sales * rule.salesPct / 100) });
  for (const m of manual) lines.push(m);
  const accrued = lines.filter(l => l.kind !== 'ADVANCE').reduce((s,l) => s+l.amount, 0);
  const adv = Math.abs(lines.filter(l => l.kind === 'ADVANCE').reduce((s,l) => s+l.amount, 0));
  return { accrued, advances: adv, toPay: accrued - adv };
}
// Знак: премия плюс, штраф и аванс минус
const sign = (kind, amount) => kind === 'BONUS' ? Math.abs(amount) : -Math.abs(amount);

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Менеджер на окладе 250 000 ₸
eq('оклад без вычетов', calc({salary:25000000,perShift:0,perHour:0,salesPct:0},0,0,0,[]).toPay, 25000000);

// Кассир: 8 000 ₸ за смену × 15 смен
eq('15 смен по 8 000', calc({salary:0,perShift:800000,perHour:0,salesPct:0},15,0,0,[]).accrued, 12000000);

// Официант: 5 000 за смену + 3% с продаж 2 млн
const waiter = calc({salary:0,perShift:500000,perHour:0,salesPct:3},20,0,200000000,[]);
eq('смены 100 000 + процент 60 000', waiter.accrued, 16000000);

// С авансом и штрафом
const withDeduct = calc({salary:25000000,perShift:0,perHour:0,salesPct:0},0,0,0,[
  { kind:'ADVANCE', amount:-10000000 },
  { kind:'FINE', amount:-500000 },
]);
eq('аванс вычитается из выдачи', withDeduct.toPay, 14500000);
eq('штраф уменьшает начисление', withDeduct.accrued, 24500000);

// Премия
eq('премия прибавляется',
  calc({salary:10000000,perShift:0,perHour:0,salesPct:0},0,0,0,[{kind:'BONUS',amount:2000000}]).accrued,
  12000000);

// Знаки
eq('премия положительна', sign('BONUS', 500000), 500000);
eq('штраф отрицателен даже если ввели плюс', sign('FINE', 500000), -500000);
eq('аванс отрицателен', sign('ADVANCE', 1000000), -1000000);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

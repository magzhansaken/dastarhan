// Разбор весового штрихкода EAN-13
function parse(code, priceOf) {
  const isW = /^\d{13}$/.test(code) && +code.slice(0,2) >= 20 && +code.slice(0,2) <= 29;
  if (!isW) return { kind:'plain', code };
  const prefix = code.slice(0,2), inner = code.slice(2,7), payload = +code.slice(7,12);
  const price = priceOf(inner);
  if (prefix === '21') {
    const total = payload * 10;
    return { kind:'weighted_price', inner, total, qty: price>0 ? +(total/price).toFixed(3) : 1 };
  }
  const qty = payload / 1000;
  return { kind:'weighted', inner, qty: +qty.toFixed(3), total: Math.round(price*qty) };
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// конина 2800 ₸/кг = 280000 тиын
const priceOf = (inner) => inner === '00123' ? 280000 : 0;

const w = parse('2200123005000', priceOf);   // 500 г
eq('весовой распознан', w.kind, 'weighted');
eq('500 грамм → 0.5 кг', w.qty, 0.5);
eq('цена за 500 г конины', w.total, 140000);

const w2 = parse('2200123012500', priceOf);  // 1250 г
eq('1250 г → 1.25 кг', w2.qty, 1.25);
eq('цена за 1.25 кг', w2.total, 350000);

const pr = parse('2100123014000', priceOf);  // цена 140.00
eq('ценовой распознан', pr.kind, 'weighted_price');
eq('цена 1400 ₸', pr.total, 140000);
eq('обратный расчёт веса', pr.qty, 0.5);

eq('обычный EAN не весовой', parse('4870204391234', priceOf).kind, 'plain');
eq('короткий код не весовой', parse('12345', priceOf).kind, 'plain');
eq('префикс 30 не весовой', parse('3000123005000', priceOf).kind, 'plain');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

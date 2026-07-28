// Приёмка: поиск расхождений
function check(ordered, received, lastPrice, price) {
  const out = [];
  if (ordered === undefined) out.push('extra');
  else if (received < ordered*0.98) out.push('short');
  else if (received > ordered*1.02) out.push('over');
  if (lastPrice > 0 && Math.round(((price-lastPrice)/lastPrice)*100) >= 10) out.push('price_up');
  return out;
}
const score = (full, total, late) => total
  ? Math.max(0, Math.round((full/total)*100 - (late/total)*30)) : 0;

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

eq('привезли ровно', check(10, 10, 280000, 280000), []);
eq('недовоз 20%', check(10, 8, 280000, 280000), ['short']);
eq('погрешность 1% — норма', check(10, 9.9, 280000, 280000), []);
eq('перевоз', check(10, 12, 280000, 280000), ['over']);
eq('не заказывали', check(undefined, 5, 0, 100000), ['extra']);
eq('подорожал на 15%', check(10, 10, 280000, 322000), ['price_up']);
eq('подорожал на 5% — молчим', check(10, 10, 280000, 294000), []);
eq('недовоз и подорожание', check(10, 7, 280000, 350000), ['short','price_up']);

eq('идеальный поставщик', score(10, 10, 0), 100);
eq('возит полностью но опаздывает', score(10, 10, 5), 85);
eq('половина заявок неполные', score(5, 10, 0), 50);
eq('плохой поставщик', score(3, 10, 8), 6);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

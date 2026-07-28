// RFM-сегментация и объяснение падения
function segment(daysAgo, count, sum, freqMid, moneyMid) {
  const recent = daysAgo <= 30;
  const often = count >= Math.max(2, freqMid);
  const rich = sum >= moneyMid;
  return recent && often && rich ? 'champions'
    : recent && often ? 'loyal'
    : recent && rich ? 'big_spender'
    : recent ? 'newcomers'
    : often && rich ? 'at_risk'
    : often ? 'sleeping' : 'lost';
}
function explain(revPct, checksPct, avgPct) {
  if (revPct > -5) return null;
  return Math.abs(checksPct) > Math.abs(avgPct)
    ? `Гостей стало меньше на ${Math.abs(checksPct)}%`
    : `Гости стали брать дешевле на ${Math.abs(avgPct)}%`;
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

// пороги: часто = 3 заказа, много = 50 000
eq('недавно, часто, много → чемпион', segment(5, 8, 12000000, 3, 5000000), 'champions');
eq('недавно, часто, средне → постоянный', segment(5, 8, 3000000, 3, 5000000), 'loyal');
eq('недавно, редко, много → крупный чек', segment(5, 1, 12000000, 3, 5000000), 'big_spender');
eq('недавно, редко, мало → новичок', segment(5, 1, 1000000, 3, 5000000), 'newcomers');
eq('давно, часто, много → уходит', segment(90, 8, 12000000, 3, 5000000), 'at_risk');
eq('давно, часто, мало → спящий', segment(90, 8, 1000000, 3, 5000000), 'sleeping');
eq('давно, редко, мало → потерян', segment(200, 1, 500000, 3, 5000000), 'lost');
eq('граница 30 дней — ещё недавно', segment(30, 1, 100, 3, 999999), 'newcomers');

eq('падение из-за гостей', explain(-12, -15, -2), 'Гостей стало меньше на 15%');
eq('падение из-за чека', explain(-12, -2, -14), 'Гости стали брать дешевле на 14%');
eq('роста не объясняем', explain(8, 5, 3), null);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

// Расчёт рекомендации закупки
function recommend(moves, have, coverDays) {
  const days = new Set(moves.map(m => m.date));
  const total = moves.reduce((s,m) => s + m.qty, 0);
  const activeDays = Math.max(1, days.size);
  const perDay = total / activeDays;

  const byDow = Array(7).fill(0);
  for (const m of moves) byDow[m.dow] += m.qty;
  const peakDow = Math.max(...byDow) / Math.max(1, activeDays/7);
  const daily = Math.max(perDay, peakDow/7);

  return {
    dailyUse: +daily.toFixed(3),
    daysLeft: daily > 0 ? Math.floor(have/daily) : 999,
    recommend: +Math.max(0, daily*coverDays - have).toFixed(3),
    urgent: daily > 0 && Math.floor(have/daily) <= 2,
  };
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Ровный расход: 2 кг в день, 14 дней
const even = Array.from({length:14},(_,i)=>({qty:2,date:`d${i}`,dow:i%7}));
const r1 = recommend(even, 6, 7);
eq('расход 2 кг/день', r1.dailyUse, 2);
eq('хватит на 3 дня', r1.daysLeft, 3);
eq('заказать 8 кг на неделю', r1.recommend, 8);
eq('не срочно', r1.urgent, false);

// Остаток на день — срочно
const r2 = recommend(even, 2, 7);
eq('остаток на 1 день — срочно', r2.urgent, true);

// Пустой склад
const r3 = recommend(even, 0, 7);
eq('пустой склад: заказать 14', r3.recommend, 14);
eq('дней осталось 0', r3.daysLeft, 0);

// Нет расхода
eq('без движений — не считаем', recommend([], 5, 7).daysLeft, 999);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

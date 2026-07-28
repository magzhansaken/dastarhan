// Нормировка рискованных действий
const per100 = (events, orders) => orders > 0 ? +((events/orders)*100).toFixed(1) : null;
function outliers(rows) {
  // Медиана вместо среднего: выброс не должен задирать порог сам себе
  const rates = rows.map(r=>r.per100).filter(x=>x!==null).sort((a,b)=>a-b);
  const median = rates.length
    ? (rates.length % 2 ? rates[(rates.length-1)/2]
       : (rates[rates.length/2-1]+rates[rates.length/2])/2) : 0;
  return rows.map(r => ({ ...r, outlier: r.per100 !== null && median > 0 && r.per100 > median*3 }));
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

// Кассир А: 10 удалений на 500 чеков. Кассир Б: 20 на 1000 — та же доля
eq('А: 2 на сто чеков', per100(10, 500), 2);
eq('Б: та же доля при вдвое большей работе', per100(20, 1000), 2);
eq('без чеков — не считаем', per100(5, 0), null);

// Аномалия: один втрое чаще
const rows = [
  { name:'Ербол',  per100: 12 },
  { name:'Айгуль', per100: 2 },
  { name:'Данияр', per100: 2.5 },
];
const marked = outliers(rows);
eq('Ербол выделен', marked.find(r=>r.name==='Ербол').outlier, true);
eq('Айгуль в норме', marked.find(r=>r.name==='Айгуль').outlier, false);

// Ровная команда — никого не помечаем
const even = outliers([{name:'A',per100:3},{name:'B',per100:3.5},{name:'C',per100:2.8}]);
eq('ровная команда без флагов', even.some(r=>r.outlier), false);

// Один человек — не с чем сравнивать
const single = outliers([{name:'A',per100:15}]);
eq('один человек не аномалия', single[0].outlier, false);

// Абсолютные числа обманывают
eq('без нормировки трудяга выглядит хуже',
  20 > 10 && per100(20,1000) === per100(10,500), true);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

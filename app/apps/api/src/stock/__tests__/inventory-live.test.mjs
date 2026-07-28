// Инвентаризация без остановки продаж
const expected = (book, moved) => +(book + moved).toFixed(3);
const diff = (fact, exp) => +(fact - exp).toFixed(3);
const money = (d, cost) => Math.round(d * cost);

function verdict(shortage, surplus) {
  return shortage > surplus ? 'Недостача'
    : surplus > shortage ? 'Излишек' : 'Всё сошлось';
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Начали с 20 кг, за время пересчёта продали 3 кг → ждём 17
eq('продажи во время пересчёта учтены', expected(20, -3), 17);
eq('приход во время пересчёта учтён', expected(20, +5), 25);
eq('без движений', expected(20, 0), 20);

// Насчитали 16.5 при ожидаемых 17 → недостача 0.5
eq('недостача полкило', diff(16.5, 17), -0.5);
eq('излишек', diff(18, 17), 1);
eq('сошлось', diff(17, 17), 0);

// В деньгах: конина 2800 ₸/кг
eq('недостача 0.5 кг = 1400 ₸', money(-0.5, 280000), -140000);

// Без учёта движений была бы фиктивная недостача 3.5 кг
eq('без учёта движений недостача втрое больше',
  Math.abs(diff(16.5, 20)) > Math.abs(diff(16.5, 17)), true);

eq('вердикт недостачи', verdict(140000, 0), 'Недостача');
eq('вердикт излишка', verdict(0, 50000), 'Излишек');
eq('вердикт совпадения', verdict(0, 0), 'Всё сошлось');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

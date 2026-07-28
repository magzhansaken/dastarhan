// Банкеты: расчёт, предоплата, закупка
const total = (subtotal, pct) => subtotal + Math.round(subtotal*pct/100);
const perGuest = (t, guests) => Math.round(t/guests);
const minPrepay = (t) => Math.round(t*0.2);
const isConfirmed = (paid, t) => paid >= minPrepay(t);
const withReserve = (qty) => +(qty*1.1).toFixed(3);
const toBuy = (need, have) => +Math.max(0, withReserve(need)-have).toFixed(3);
function hint(days) {
  return days <= 1 ? 'закупка готова'
    : days <= 3 ? 'скоропортящееся'
    : 'крупы и консервы';
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Банкет на 40 человек, меню 1 200 000 ₸, сервис 10%
const sub = 120000000;
eq('итог с сервисом 10%', total(sub, 10), 132000000);
eq('без сервисного сбора', total(sub, 0), 120000000);
eq('на человека', perGuest(total(sub,10), 40), 3300000);

eq('минимальная предоплата 20%', minPrepay(132000000), 26400000);
eq('внесли 300 000 — подтверждён', isConfirmed(30000000, 132000000), true);
eq('внесли 100 000 — мало', isConfirmed(10000000, 132000000), false);

// Закупка: нужно 8 кг конины, на складе 2
eq('запас 10% сверху', withReserve(8), 8.8);
eq('купить с учётом остатка', toBuy(8, 2), 6.8);
eq('всё есть — не покупаем', toBuy(8, 10), 0);
eq('склад пуст — берём всё с запасом', toBuy(8, 0), 8.8);

eq('за день до — готово', hint(1), 'закупка готова');
eq('за три дня — скоропорт', hint(3), 'скоропортящееся');
eq('за неделю — крупы', hint(7), 'крупы и консервы');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

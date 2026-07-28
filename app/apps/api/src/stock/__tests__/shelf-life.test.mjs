// Контроль сроков хранения
const expiresAt = (producedAt, hours) => hours ? producedAt + hours*3600_000 : null;
function classify(expires, now) {
  if (expires === null) return 'no_limit';
  const left = expires - now;
  const h = Math.floor(left / 3600_000);
  if (left <= 0) return 'expired';
  if (h <= 2) return 'urgent';
  if (h <= 6) return 'soon';
  return 'ok';
}
const canSell = (blocked) => blocked.length === 0;

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

const now = Date.UTC(2026,6,28,12,0);
const h = (n) => n*3600_000;

// Салат 12 часов, суп 24, заготовка 72
eq('салат живёт 12 часов', expiresAt(now, 12), now + h(12));
eq('без срока — бессрочно', expiresAt(now, null), null);

eq('свежий салат в порядке', classify(now + h(10), now), 'ok');
eq('через 5 часов — скоро', classify(now + h(5), now), 'soon');
eq('через час — срочно', classify(now + h(1), now), 'urgent');
eq('час назад — просрочен', classify(now - h(1), now), 'expired');
eq('ровно сейчас — просрочен', classify(now, now), 'expired');
eq('без срока не классифицируем', classify(null, now), 'no_limit');

eq('всё свежее — продаём', canSell([]), true);
eq('просрочен ингредиент — блокируем', canSell(['Зирвак']), false);

// Приготовили в 8 утра, сейчас 12 — салату осталось 8 часов
const made = Date.UTC(2026,6,28,8,0);
eq('утренний салат ещё годен', classify(expiresAt(made,12), now), 'ok');
// Вчерашний суп
const yesterday = Date.UTC(2026,6,27,10,0);
eq('вчерашний суп просрочен', classify(expiresAt(yesterday,24), now), 'expired');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

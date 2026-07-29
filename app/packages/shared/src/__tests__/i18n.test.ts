import { STRINGS, t, i18nGaps } from '../i18n.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,100)}`))};

// полнота: каждый ключ имеет ru и kk
eq('словарь без дыр', i18nGaps(), []);
eq('ключей достаточно для кассы+офиса (≥45)', Object.keys(STRINGS).length >= 45, true);

// перевод работает
eq('kk: Оплата → Төлем', t('order.pay','kk'), 'Төлем');
eq('kk: Сдача → Қайтарым', t('pay.change','kk'), 'Қайтарым');
eq('ru: fallback', t('order.pay','ru'), 'Оплата');

// критичные кассовые строки есть на обоих языках
for (const k of ['pin.enter','order.pay','pay.due','pay.change','sync.offline','shift.close'] as const) {
  eq(`критичный ключ ${k}: kk непустой`, STRINGS[k].kk.length > 0, true);
}

// kk не равен ru (реальный перевод, не копипаст) — кроме СТОП
let copies = 0;
for (const [k,v] of Object.entries(STRINGS)) {
  if (v.ru === v.kk && k !== 'order.stop' && k !== 'onb.min' && k !== 'nav.pnl') copies++;
}
eq('kk — настоящий перевод (копий ≤ 2)', copies <= 2, true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

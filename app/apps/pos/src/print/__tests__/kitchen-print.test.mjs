// Разбивка по цехам и блокировка счёта пречеком
function splitByStation(items) {
  const map = new Map();
  for (const i of items) {
    const k = i.stationId ?? '__none';
    const cur = map.get(k);
    if (cur) cur.items.push(i);
    else map.set(k, { station: i.stationId ?? null, items: [i] });
  }
  return [...map.values()];
}
// Пречек блокирует счёт: после печати изменения только со снятием
const canEdit = (o) => !o.precheckedAt || o.unlockedBy != null;
const money = (v) => `${Math.trunc(v/100).toLocaleString('ru-RU').replace(/\u00A0/g,' ')} ₸`;

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

const items = [
  { name:'Шашлык', stationId:'mangal' },
  { name:'Салат',  stationId:'cold' },
  { name:'Люля',   stationId:'mangal' },
  { name:'Чай',    stationId:null },
];
const parts = splitByStation(items);
eq('три цеха', parts.length, 3);
eq('мангал получил два блюда', parts.find(p=>p.station==='mangal').items.length, 2);
eq('чай без цеха — отдельно', parts.find(p=>p.station===null).items.length, 1);

eq('до пречека редактируем', canEdit({}), true);
eq('после пречека заблокирован', canEdit({precheckedAt:'2026-07-28'}), false);
eq('старший разблокировал', canEdit({precheckedAt:'x', unlockedBy:'user1'}), true);

eq('формат суммы', money(650000), '6 500 ₸');
eq('крупная сумма с пробелом', money(12500000), '125 000 ₸');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

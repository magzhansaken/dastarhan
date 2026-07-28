// Расписание меню и массовые цены
function isActive(s, dow, minutes) {
  const dayOk = s.days.length === 0 || s.days.includes(dow);
  const timeOk = s.fromMin <= s.toMin
    ? minutes >= s.fromMin && minutes < s.toMin
    : minutes >= s.fromMin || minutes < s.toMin;
  return dayOk && timeOk;
}
const bulk = (price, pct, roundTo) => {
  const raw = Math.round(price * (100+pct)/100);
  return Math.round(raw/roundTo)*roundTo;
};
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g} ≠ ${w}`))};

// Бизнес-ланч 12:00–16:00 по будням
const lunch = { days:[0,1,2,3,4], fromMin:720, toMin:960 };
eq('вторник 13:00 — ланч идёт', isActive(lunch, 1, 780), true);
eq('вторник 17:00 — поздно', isActive(lunch, 1, 1020), false);
eq('вторник 11:00 — рано', isActive(lunch, 1, 660), false);
eq('суббота 13:00 — выходной', isActive(lunch, 5, 780), false);
eq('граница 16:00 — уже нет', isActive(lunch, 1, 960), false);

// Бар 20:00–02:00 — через полночь
const bar = { days:[], fromMin:1200, toMin:120 };
eq('бар в 22:00 работает', isActive(bar, 3, 1320), true);
eq('бар в 01:00 работает', isActive(bar, 3, 60), true);
eq('бар в 15:00 закрыт', isActive(bar, 3, 900), false);
eq('бар в 03:00 закрыт', isActive(bar, 3, 180), false);

// Массовое повышение с округлением до 50 ₸
eq('2500 +10% = 2750', bulk(250000, 10, 5000), 275000);
eq('2847 округляется до 2850', bulk(271143, 5, 5000), 285000);
eq('снижение цены', bulk(250000, -10, 5000), 225000);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

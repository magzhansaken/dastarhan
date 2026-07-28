// Нормализация телефона и ранжирование адресов
function norm(phone) {
  const d = (phone??'').replace(/\D/g,'');
  if (d.length < 10) return null;
  if (d.length===11 && (d[0]==='7'||d[0]==='8')) return '+7'+d.slice(1);
  if (d.length===10) return '+7'+d;
  return '+'+d;
}
const needConfirm = (days) => days === null || days > 180;
const promise = (cook, drive) => cook + drive;

let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

eq('8 707 → +7707', norm('8 707 214 88 30'), '+77072148830');
eq('+7 707 остаётся', norm('+7 707 214 88 30'), '+77072148830');
eq('10 цифр', norm('7072148830'), '+77072148830');
eq('короткий — null', norm('12345'), null);

eq('вчерашний адрес не переспрашиваем', needConfirm(1), false);
eq('полугодовой переспрашиваем', needConfirm(200), true);
eq('неизвестная давность — переспрашиваем', needConfirm(null), true);

eq('обещание 25+30 = 55 мин', promise(25,30), 55);
eq('ближняя зона быстрее', promise(25,15), 40);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

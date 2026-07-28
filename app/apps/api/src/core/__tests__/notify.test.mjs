// Уведомления: тихие часы, дедупликация, приоритет
function canDisturb(level, hour, quietFrom, quietTo) {
  if (level === 'URGENT') return true;
  if (quietFrom == null || quietTo == null) return true;
  const quiet = quietFrom <= quietTo
    ? hour >= quietFrom && hour < quietTo
    : hour >= quietFrom || hour < quietTo;
  return !quiet;
}
// Повтор только после интервала и если не решено
function shouldSend(lastSentH, repeatAfterH, resolved) {
  if (resolved) return false;
  if (lastSentH === null) return true;
  return lastSentH >= repeatAfterH;
}
const order = { URGENT:0, WARN:1, INFO:2 };
const sortByPriority = (rows) => [...rows].sort((a,b) =>
  order[a.level] - order[b.level] || b.age - a.age);

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

// Тихие часы 23:00–08:00
eq('днём беспокоим', canDisturb('WARN', 14, 23, 8), true);
eq('ночью молчим', canDisturb('WARN', 2, 23, 8), false);
eq('в 23:00 уже тихо', canDisturb('WARN', 23, 23, 8), false);
eq('в 8 утра можно', canDisturb('WARN', 8, 23, 8), true);
eq('срочное будит ночью', canDisturb('URGENT', 3, 23, 8), true);
eq('без тихих часов — всегда', canDisturb('WARN', 3, null, null), true);

eq('первое уведомление шлём', shouldSend(null, 24, false), true);
eq('через час не повторяем', shouldSend(1, 24, false), false);
eq('через сутки повторяем', shouldSend(25, 24, false), true);
eq('решённое не повторяем', shouldSend(100, 24, true), false);

const rows = [
  { level:'INFO', age:10 },
  { level:'URGENT', age:1 },
  { level:'WARN', age:5 },
];
eq('срочное первым', sortByPriority(rows)[0].level, 'URGENT');
eq('информационное последним', sortByPriority(rows)[2].level, 'INFO');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

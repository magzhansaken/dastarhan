// Утренняя сводка владельцу
const change = (now, was) => was > 0 ? Math.round(((now-was)/was)*100) : null;
const tone = (pct) => pct === null ? 'neutral' : pct >= 0 ? 'good' : pct <= -20 ? 'bad' : 'warn';
function actions(data) {
  const out = [];
  if (data.openShifts > 0) out.push({ urgency:'now' });
  if (data.lowStock > 0) out.push({ urgency:'today' });
  if (data.pct !== null && data.pct <= -20) out.push({ urgency:'today' });
  return out.slice(0, 3);
}
function summary(offline, openTables, checks) {
  return offline.length ? `Касса «${offline[0]}» не в сети`
    : openTables > 0 ? `${openTables} столов занято`
    : checks > 0 ? `Сегодня ${checks} чеков`
    : 'Продаж пока нет';
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

eq('рост 15%', change(115000, 100000), 15);
eq('падение 30%', change(70000, 100000), -30);
eq('нет прошлых данных', change(100000, 0), null);

eq('рост — хорошо', tone(15), 'good');
eq('лёгкое падение — предупреждение', tone(-8), 'warn');
eq('провал — плохо', tone(-25), 'bad');

eq('всё спокойно — без задач',
  actions({openShifts:0, lowStock:0, pct:5}).length, 0);
eq('незакрытая смена — срочно',
  actions({openShifts:1, lowStock:0, pct:5})[0].urgency, 'now');
eq('не больше трёх задач',
  actions({openShifts:1, lowStock:5, pct:-30}).length, 3);

eq('офлайн касса важнее всего',
  summary(['Касса 1'], 5, 100), 'Касса «Касса 1» не в сети');
eq('занятые столы вечером', summary([], 5, 100), '5 столов занято');
eq('закрытый зал', summary([], 0, 142), 'Сегодня 142 чеков');
eq('утро без продаж', summary([], 0, 0), 'Продаж пока нет');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

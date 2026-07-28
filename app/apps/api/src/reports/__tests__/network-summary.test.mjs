// Сводка по сети точек
const perStaff = (rev, staff) => staff ? Math.round(rev/staff) : 0;
const change = (now, was) => was > 0 ? +(((now-was)/was)*100).toFixed(1) : null;
const gap = (best, worst) => worst > 0 ? +(best/worst).toFixed(1) : null;
const isOffline = (lastSeen, now) => !lastSeen || (now - lastSeen) > 2*3600_000;

function alerts(rows) {
  const out = [];
  for (const r of rows) {
    if (r.offline) out.push({level:'high', text:'Касса не в сети'});
    if (r.changePct !== null && r.changePct <= -20) out.push({level:'high', text:`Упала на ${Math.abs(r.changePct)}%`});
  }
  return out;
}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};

eq('выручка на сотрудника', perStaff(90000000, 9), 10000000);
eq('без штата — ноль', perStaff(90000000, 0), 0);

eq('рост 20%', change(120, 100), 20);
eq('падение 25%', change(75, 100), -25);
eq('нет прошлых данных', change(100, 0), null);

eq('разрыв втрое', gap(300000, 100000), 3);
eq('одинаковые точки', gap(100000, 100000), 1);

const now = Date.now();
eq('касса онлайн', isOffline(now - 60_000, now), false);
eq('касса молчит 3 часа', isOffline(now - 3*3600_000, now), true);
eq('касса не активирована', isOffline(null, now), true);

eq('две проблемы — два алерта',
  alerts([{offline:true, changePct:-30},{offline:false, changePct:5}]).length, 2);
eq('всё в норме — тишина',
  alerts([{offline:false, changePct:3}]).length, 0);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

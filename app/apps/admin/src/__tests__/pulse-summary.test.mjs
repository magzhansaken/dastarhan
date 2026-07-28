function churnRiskSummary(offline, noReceipts, revenueDown) {
  const total = offline + noReceipts + revenueDown;
  return `${total} клиентов с сигналами ухода: ${offline} не в сети, ${noReceipts} без чеков, ${revenueDown} с просевшей выручкой.`;
}
const staffSummary = (u,r,s) => `${u} сотрудников · ${r} роли · последняя смена закрыта ${s}`;
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('сводка оттока', churnRiskSummary(4,5,5), '14 клиентов с сигналами ухода: 4 не в сети, 5 без чеков, 5 с просевшей выручкой.');
eq('нет рисков', churnRiskSummary(0,0,0), '0 клиентов с сигналами ухода: 0 не в сети, 0 без чеков, 0 с просевшей выручкой.');
eq('сводка сотрудников', staffSummary(9,3,'сегодня в 02:14'), '9 сотрудников · 3 роли · последняя смена закрыта сегодня в 02:14');
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

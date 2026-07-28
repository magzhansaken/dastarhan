const mrrShare=(c,t)=>t<=0?0:Math.round((c/t)*1000)/10;
function callOpener(s){
 if(s.offlineDays&&s.offlineDays>=2)return `Касса не в сети ${s.offlineDays} дня — спросить, что случилось`;
 if(s.noReceiptsDays&&s.noReceiptsDays>=2)return `Чеков нет ${s.noReceiptsDays} дня — возможно, вернулись на старую систему`;
 if(s.revenueDropPct&&s.revenueDropPct<=-30)return `Выручка упала на ${Math.abs(s.revenueDropPct)}% — узнать, сезон это или проблема`;
 return 'Плановый звонок — спросить, всё ли устраивает';}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${g}`))};
eq('доля MRR', mrrShare(180000, 1636000), 11);
eq('нулевой MRR', mrrShare(1000, 0), 0);
eq('офлайн — главный сигнал', callOpener({offlineDays:3,revenueDropPct:-40}), 'Касса не в сети 3 дня — спросить, что случилось');
eq('нет чеков', callOpener({noReceiptsDays:2}), 'Чеков нет 2 дня — возможно, вернулись на старую систему');
eq('падение выручки', callOpener({revenueDropPct:-35}), 'Выручка упала на 35% — узнать, сезон это или проблема');
eq('всё в порядке', callOpener({}), 'Плановый звонок — спросить, всё ли устраивает');
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

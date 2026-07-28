// Готовность к первому чеку
function readiness(state) {
  const steps = [
    { key:'menu',      done: state.products > 0, blocking: true },
    { key:'terminal',  done: state.terminalActive, blocking: true },
    { key:'staff',     done: state.staff > 0, blocking: false },
    { key:'stock',     done: state.stock > 0, blocking: false },
    { key:'techcards', done: state.cards > 0, blocking: false },
  ];
  const blockers = steps.filter(s => s.blocking && !s.done);
  const done = steps.filter(s => s.done).length;
  return {
    progress: Math.round((done/steps.length)*100),
    canSell: blockers.length === 0,
    blockers: blockers.map(b => b.key),
    complete: done === steps.length,
  };
}
// Расчёт фудкоста из шаблона: плов
const cardCost = (lines, prices) => lines.reduce((s,l) => s + l.qty*(prices[l.ing]??0), 0);
const foodCostPct = (cost, price) => +((cost/price)*100).toFixed(1);

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

eq('пустой аккаунт — нельзя продавать',
  readiness({products:0,terminalActive:false,staff:0,stock:0,cards:0}).canSell, false);
eq('и два блокера',
  readiness({products:0,terminalActive:false,staff:0,stock:0,cards:0}).blockers,
  ['menu','terminal']);

eq('меню есть, кассы нет',
  readiness({products:6,terminalActive:false,staff:0,stock:0,cards:0}).blockers, ['terminal']);

eq('минимум для продаж',
  readiness({products:6,terminalActive:true,staff:0,stock:0,cards:0}).canSell, true);
eq('прогресс 40%',
  readiness({products:6,terminalActive:true,staff:0,stock:0,cards:0}).progress, 40);

eq('всё настроено',
  readiness({products:6,terminalActive:true,staff:2,stock:8,cards:4}).complete, true);
eq('прогресс 100%',
  readiness({products:6,terminalActive:true,staff:2,stock:8,cards:4}).progress, 100);

// Плов из шаблона: говядина 125г, рис 120г, морковь 80г, масло 30мл
const prices = { 'Говядина':250000, 'Рис':60000, 'Морковь':35000, 'Масло растительное':90000 };
const plov = [
  { ing:'Говядина', qty:0.125 }, { ing:'Рис', qty:0.12 },
  { ing:'Морковь', qty:0.08 }, { ing:'Масло растительное', qty:0.03 },
];
eq('себестоимость плова', cardCost(plov, prices), 43950);
eq('фудкост при цене 2500', foodCostPct(cardCost(plov, prices), 250000), 17.6);
eq('фудкост в норме до 30%', foodCostPct(cardCost(plov, prices), 250000) < 30, true);

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

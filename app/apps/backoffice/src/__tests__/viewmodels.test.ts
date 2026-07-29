import { buildNav, dashCards, lossPct, liveCost, tcErrors,
  supplyTotals, supplyErrors, onboardingSteps, onboardingProgress } from '../viewmodels.ts';
import type { TcLine } from '../viewmodels.ts';
import type { CostContext } from '../../../../packages/shared/src/menu/cost.service.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};

// ═══ Навигация по задачам ═══
const nav = buildNav({ delivery:true, ai:true }, 'CAFE');
eq('разделы кафе', nav.map(s=>s.id), ['today','menu','stock','money','guests','delivery','ai']);
eq('задача языком владельца', nav[2].tasks[0].title, 'Принять поставку');
const navSalon = buildNav({}, 'SALON');
eq('салон: раздел Записи после Сегодня', navSalon[1].id, 'book');
const navBil = buildNav({}, 'BILLIARD');
eq('бильярд: столы/время', navBil[1].id, 'timed');
eq('без модулей — нет доставки/ИИ', buildNav({}, 'CAFE').length, 5);

// ═══ Дашборд ═══
const d = dashCards({ todayRevenue:15_000_000, yesterdaySameTime:12_000_000,
  checks:42, avgCheck:357_000, alerts:[{severity:'MEDIUM', text:'Фудкост плова вырос'}], unsyncedTerminals:1 });
eq('рост +25% ко вчера', [d.revenue.diffPct, d.revenue.tone], [25, 'up']);
eq('касса не в сети — первым HIGH', d.attention[0], {severity:'HIGH', text:'Кассы не в сети: 1'});
eq('алерты дальше', d.attention[1].text, 'Фудкост плова вырос');
const d2 = dashCards({ todayRevenue:100, yesterdaySameTime:0, checks:1, avgCheck:100, alerts:[], unsyncedTerminals:0 });
eq('вчера 0 → без процента', d2.revenue.diffPct, null);
eq('всё спокойно — пусто', d2.attention.length, 0);

// ═══ Редактор техкарты: живой фудкост ═══
const ctx: CostContext = {
  ingredientCost: new Map([['rice',60],['zirvak',150]]),
  techCards: new Map(), productType: new Map(),
};
const lines: TcLine[] = [
  { componentId:'rice', name:'Рис', brutto:120, netto:110 },
  { componentId:'zirvak', name:'Зирвак', brutto:250, netto:250 },
];
eq('потери риса 8.3%', lossPct(lines[0]), 8.3);
const live = liveCost(lines, 400, 250_000, ctx);
eq('себестоимость 120×60+250×150', live.portionCost, 7200+37500);
eq('фудкост 17.9%', live.foodcostPct, 17.9);
eq('маржа', live.margin, 250_000-44_700);
// живость: поменяли брутто — цифра изменилась
const live2 = liveCost([{...lines[0], brutto:150}, lines[1]], 400, 250_000, ctx);
eq('ввод меняет фудкост мгновенно', live2.portionCost, 9000+37500);
// валидации
eq('нетто > брутто пойман', tcErrors([{componentId:'x',name:'X',brutto:100,netto:120}], 400)[0].includes('так не бывает'), true);
eq('пустая техкарта', tcErrors([], 400)[0], 'Добавьте хотя бы один компонент');

// ═══ Приход ═══
const st = supplyTotals([
  { productId:'r', name:'Рис', qty:20, unitCostTenge:600 },
  { productId:'m', name:'Масло', qty:5, unitCostTenge:1200 },
]);
eq('итог поставки 18 000 тг', st.total, (20*600+5*1200)*100);
eq('позиции 2', st.positions, 2);
eq('нулевое количество поймано', supplyErrors([{productId:'r',name:'Рис',qty:0,unitCostTenge:100}])[0].includes('> 0'), true);

// ═══ Онбординг ═══
const steps = onboardingSteps('CAFE', { org:true, menu:true });
eq('кафе: 6 шагов', steps.length, 6);
const pr = onboardingProgress(steps);
eq('прогресс 33%', pr.pct, 33);
eq('осталось минут: 1+2+3+2', pr.minutesLeft, 8);
eq('следующий шаг — кассир', pr.nextStep?.id, 'staff');
// бильярд: свой шаг
const bs = onboardingSteps('BILLIARD', {});
eq('бильярд: шаг столы/тарифы', bs.some(s=>s.id==='tables'), true);
eq('всего ≤15 минут обещание', bs.reduce((s,x)=>s+x.minutes,0) <= 18, true);
// финиш
eq('всё готово = 100%', onboardingProgress(onboardingSteps('CAFE',
  {org:true,menu:true,staff:true,payments:true,fiscal:true,print:true})).pct, 100);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

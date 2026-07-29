import { currentTier, nextTierProgress, DEALER_TIERS, isCommissionable,
  splitWithParent, subDealersOf, payableNow, MIN_PAYOUT, extendDemo,
  DEMO_MAX_EXTENSIONS, DealerError } from '../../../../packages/shared/src/platform/dealer.logic.ts';
import type { DealerNode, Attribution } from '../../../../packages/shared/src/platform/dealer.logic.ts';
import { PLANS, planByKey, hasFeature, minPlanFor, featureLock,
  featuresLostOnDowngrade, nextInvoice, PLAN_FEATURES, FEATURE_TITLES,
  INVOICE_LEAD_DAYS } from '../../../../packages/shared/src/platform/billing.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,120)} want ${JSON.stringify(w).slice(0,120)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`)}catch(e:any){e.code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${e.code}`))}};
const D=(d:number)=>new Date(2026,6,d);

console.log('── КАТЕГОРИИ ДИЛЕРА ──');
eq('4 категории', DEALER_TIERS.length, 4);
eq('новичок → Старт 12%', currentTier(0, 0).ratePct, 12);
eq('5 клиентов + 50k базы → Партнёр 15%', currentTier(5, 5_000_000).ratePct, 15);
eq('15 клиентов + 200k → Эксперт 18%', currentTier(15, 20_000_000).ratePct, 18);
eq('40 клиентов + 600k → Мастер 22%', currentTier(40, 60_000_000).ratePct, 22);
// оба условия обязательны
eq('много клиентов, мало базы → не поднимаем', currentTier(40, 1_000_000).ratePct, 12);
eq('один жирный клиент не даёт Мастера', currentTier(1, 100_000_000).ratePct, 12);
// прогресс
const pr = nextTierProgress(3, 3_000_000);
eq('до Партнёра: +2 клиента, +20 000 базы', [pr!.next.name, pr!.needClients, pr!.needBase], ['Партнёр', 2, 2_000_000]);
const pr2 = nextTierProgress(10, 20_000_000);
eq('база хватает, клиентов нет', [pr2!.needClients, pr2!.needBase], [5, 0]);
eq('высшая → null', nextTierProgress(50, 100_000_000), null);

console.log('── ЗАЩИТА ОТ ПРИСВОЕНИЯ КЛИЕНТОВ ──');
const A=(o:Partial<Attribution>):Attribution=>({accountId:'a', ...o});
eq('нет дилера → нет комиссии', isCommissionable(A({})), false);
eq('закреплён до первой оплаты → комиссия есть',
  isCommissionable(A({dealerId:'d1', attributedAt:D(1), firstPaymentAt:D(5)})), true);
eq('прикрепился ПОСЛЕ первой оплаты → нет',
  isCommissionable(A({dealerId:'d1', attributedAt:D(10), firstPaymentAt:D(5)})), false);
eq('клиент ещё не платил → есть',
  isCommissionable(A({dealerId:'d1', attributedAt:D(1), firstPaymentAt:null})), true);
eq('в тот же день — засчитываем',
  isCommissionable(A({dealerId:'d1', attributedAt:D(5), firstPaymentAt:D(5)})), true);

console.log('── СУБДИЛЕРЫ ──');
const nodes: DealerNode[] = [
  {dealerId:'top', name:'Алматы Центр'},
  {dealerId:'sub1', name:'Шымкент', parentDealerId:'top', parentSharePct:20},
  {dealerId:'sub2', name:'Туркестан', parentDealerId:'sub1', parentSharePct:15},
  {dealerId:'other', name:'Астана'},
];
eq('без куратора — всё себе', splitWithParent(1_000_000, nodes[0]), {toDealer:1_000_000, toParent:0});
eq('субдилер отдаёт 20%', splitWithParent(1_000_000, nodes[1]), {toDealer:800_000, toParent:200_000});
eq('вся ветка от top', subDealersOf('top', nodes).map(n=>n.dealerId), ['sub1','sub2']);
eq('ветка от sub1', subDealersOf('sub1', nodes).map(n=>n.dealerId), ['sub2']);
eq('чужой не попал', subDealersOf('top', nodes).some(n=>n.dealerId==='other'), false);

console.log('── ВЫПЛАТЫ ──');
eq('меньше минимума — переносим', payableNow(500_000), {pay:0, carryOver:500_000, note:'Меньше минимума — перенесём на следующий месяц'});
eq('с переносом набралось', payableNow(600_000, 500_000).pay, 1_100_000);
eq('ровно минимум — платим', payableNow(MIN_PAYOUT).pay, MIN_PAYOUT);
eq('после выплаты перенос обнулён', payableNow(2_000_000).carryOver, 0);

console.log('── ПРОДЛЕНИЕ СТЕНДА ──');
let demo = { expiresAt: D(20), extendedTimes: 0 };
demo = extendDemo(demo, D(19));
eq('первое продление +7 дней', demo.expiresAt.getDate(), 27);
eq('счётчик 1', demo.extendedTimes, 1);
demo = extendDemo(demo, D(19));
eq('второе продление', demo.extendedTimes, 2);
throws('третье — запрет', ()=>extendDemo(demo, D(19)), 'DEMO_LIMIT');
// истёкший продлевается от сегодня, а не от прошлой даты
const expired = extendDemo({expiresAt: D(10), extendedTimes:0}, D(19));
eq('истёкший стенд считает от сегодня', expired.expiresAt.getDate(), 26);

console.log('── ТАРИФЫ И ЗАМОК ФУНКЦИЙ ──');
eq('3 тарифа', PLANS.length, 3);
eq('Старт 12 000 ₸', planByKey('START').pricePerLocation, 1200000);
eq('Бизнес 18 000 ₸', planByKey('BUSINESS').pricePerLocation, 1800000);
eq('Сеть 26 000 ₸', planByKey('NETWORK').pricePerLocation, 2600000);
eq('касса есть везде', PLANS.every(p=>hasFeature(p.key,'pos')), true);
eq('доставки на Старте нет', hasFeature('START','delivery'), false);
eq('доставка на Бизнесе есть', hasFeature('BUSINESS','delivery'), true);
eq('центрального склада на Бизнесе нет', hasFeature('BUSINESS','central_stock'), false);
eq('на Сети есть', hasFeature('NETWORK','central_stock'), true);
eq('минимальный тариф для P&L — Бизнес', minPlanFor('reports.pnl')?.key, 'BUSINESS');
eq('для франшизы — Сеть', minPlanFor('franchise')?.key, 'NETWORK');
// замок
eq('на Бизнесе P&L открыт — замка нет', featureLock('reports.pnl','BUSINESS'), null);
const lock = featureLock('reports.pnl','START');
eq('на Старте P&L закрыт', lock !== null, true);
eq('текст замка называет тариф', lock!.title.includes('Бизнес'), true);
eq('замок объясняет ценность', lock!.body.length > 10, true);
eq('разница в цене 6 000 ₸', lock!.priceDiff, 600000);
eq('нужный тариф', lock!.neededPlan, 'BUSINESS');
eq('все ключи функций имеют названия',
  Object.keys(FEATURE_TITLES).every(k=>PLAN_FEATURES.NETWORK.includes(k)), true);
// потери при понижении
const lost = featuresLostOnDowngrade('BUSINESS','START');
eq('с Бизнеса на Старт теряем доставку', lost.includes('Доставка и курьеры'), true);
eq('и ИИ-помощника', lost.includes('ИИ-помощник'), true);
eq('и чаевые', lost.includes('Чаевые по QR'), true);
eq('со Старта на Старт — ничего', featuresLostOnDowngrade('START','START'), []);
eq('повышение ничего не теряет', featuresLostOnDowngrade('START','NETWORK'), []);

console.log('── ПРЕДОПЛАТНЫЙ СЧЁТ ──');
const inv = nextInvoice(planByKey('BUSINESS'),
  [{id:'l1',name:'Абая',terminals:1},{id:'l2',name:'Достык',terminals:3}], D(1), 42);
eq('сумма: 2 точки Бизнес + 2 доп кассы', inv.amount, 1800000*2 + 400000*2);
eq('номер счёта формата DS-ГГГГММ-NNNN', inv.number, 'DS-202607-0042');
eq('период месяц', [inv.periodFrom.getDate(), inv.periodTo.getMonth()], [1, 7]);
eq('выставлен за 5 дней до начала',
  Math.round((inv.periodFrom.getTime()-inv.issuedAt!.getTime())/86400000), INVOICE_LEAD_DAYS);
eq('срок оплаты = начало периода', inv.dueAt.getTime(), inv.periodFrom.getTime());
eq('статус PENDING', inv.status, 'PENDING');

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

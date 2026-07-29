import { PLANS, planByKey, billingBreakdown, addLocationCost, planChange,
  invoiceStatusLabel, closingDocs, billingState, whatWorks, canRequestDeferral } from '../../../../packages/shared/src/platform/billing.logic.ts';
import type { Invoice, LocationBilling } from '../../../../packages/shared/src/platform/billing.logic.ts';
import { dealerPortfolio, clientCommission, clientAction, commissionAtRisk,
  nextPayoutDate, payoutForecast, paidTotal, commissionGrowthPct,
  demoStandState, demoConversionRate, accreditationSteps, accreditationProgress } from '../../../../packages/shared/src/platform/dealer.logic.ts';
import type { DealerClient, MonthlyAccrual, DemoStand } from '../../../../packages/shared/src/platform/dealer.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,120)} want ${JSON.stringify(w).slice(0,120)}`))};
const D=(d:number,h=12)=>new Date(2026,6,d,h);

console.log('── БИЛЛИНГ: тарифы и разбивка ──');
eq('три тарифа', PLANS.map(p=>p.key), ['START','BUSINESS','NETWORK']);
eq('цены 12/18/26 тыс', PLANS.map(p=>p.pricePerLocation), [1200000, 1800000, 2600000]);
eq('Сеть включает 2 кассы', planByKey('NETWORK').includedTerminalsPerLocation, 2);
const locs: LocationBilling[] = [
  {id:'l1', name:'Абая 10', terminals:1},
  {id:'l2', name:'Достык 88', terminals:3},   // 2 сверх лимита
];
const bd = billingBreakdown(planByKey('BUSINESS'), locs);
eq('база 2 точки × 18000', bd.lines[0].sum, 3600000);
eq('доп. касс 2', bd.extraTerminals, 2);
eq('строка доп. касс 2×4000', bd.lines[1].sum, 800000);
eq('итого 44 000 ₸', bd.total, 4400000);
eq('склонение «2 точки»', bd.lines[0].label.includes('2 точки'), true);
const bd1 = billingBreakdown(planByKey('START'), [{id:'l',name:'X',terminals:1}]);
eq('одна точка без доп. касс — одна строка', bd1.lines.length, 1);
eq('склонение «1 точка»', bd1.lines[0].label.includes('1 точка'), true);
const bd5 = billingBreakdown(planByKey('START'), Array.from({length:5},(_,i)=>({id:`l${i}`,name:'X',terminals:1})));
eq('склонение «5 точек»', bd5.lines[0].label.includes('5 точек'), true);

console.log('── БИЛЛИНГ: добавление точки и смена тарифа ──');
const add = addLocationCost(planByKey('BUSINESS'), D(19), D(31));
eq('осталось 12 дней', add.daysLeft, 12);
eq('в месяц +18000', add.monthlyDelta, 1800000);
eq('сейчас пропорционально 12/30', add.chargeNow, Math.round(1800000*12/30));
const up = planChange(planByKey('START'), planByKey('BUSINESS'), 2, D(19), D(31));
eq('апгрейд — сразу', [up.direction, up.effectiveFrom.getDate()], ['upgrade', 19]);
eq('апгрейд: доплата > 0', up.chargeNow > 0, true);
eq('апгрейд: возможности сразу', up.note.includes('сразу'), true);
const down = planChange(planByKey('NETWORK'), planByKey('START'), 2, D(19), D(31));
eq('даунгрейд — со следующего периода', [down.direction, down.effectiveFrom.getDate()], ['downgrade', 31]);
eq('даунгрейд: без доплаты', down.chargeNow, 0);
eq('тот же тариф', planChange(planByKey('START'), planByKey('START'), 1, D(19), D(31)).direction, 'same');

console.log('── БИЛЛИНГ: счета и документы ──');
const INV=(o:Partial<Invoice>):Invoice=>({id:'i1', number:'2026-07', periodFrom:D(1), periodTo:D(31),
  amount:4400000, status:'PENDING', dueAt:D(25), ...o});
eq('оплачен', invoiceStatusLabel(INV({status:'PAID'}), D(26)).tone, 'ok');
eq('срок не вышел', invoiceStatusLabel(INV({}), D(20)).tone, 'warn');
eq('осталось 5 дней', invoiceStatusLabel(INV({}), D(20)).text.includes('5 дней'), true);
eq('просрочен на 3 дня', invoiceStatusLabel(INV({}), D(28)).text, 'Просрочен на 3 дня');
eq('просрочка — красным', invoiceStatusLabel(INV({}), D(28)).tone, 'danger');
// закрывающие документы — наш ответ Paloma
const docsPaid = closingDocs(INV({status:'PAID', method:'card'}));
eq('картой — документы ЕСТЬ (у Paloma нельзя)', docsPaid.available, true);
eq('три документа', docsPaid.docs.length, 3);
eq('способ оплаты не важен', docsPaid.note.includes('значения не имеет'), true);
eq('до оплаты — документов нет', closingDocs(INV({})).available, false);

console.log('── БИЛЛИНГ: деградация ──');
eq('нет счёта → активна', billingState(null, D(19)).state, 'ACTIVE');
eq('оплачен → активна', billingState(INV({status:'PAID'}), D(19)).state, 'ACTIVE');
eq('срок не вышел → активна', billingState(INV({}), D(20)).state, 'ACTIVE');
const grace = billingState(INV({}), D(28));  // 3 дня просрочки
eq('3 дня просрочки → grace', grace.state, 'GRACE');
eq('grace: осталось 4 дня', grace.daysLeft, 4);
eq('grace: касса работает', grace.body.includes('Касса работает'), true);
const susp = billingState(INV({}), new Date(2026,7,3));  // 9 дней
eq('9 дней → suspended', susp.state, 'SUSPENDED');
eq('suspended: смену закрыть можно', susp.body.includes('Закрыть открытую смену'), true);
// что работает
const wA = whatWorks('ACTIVE'), wG = whatWorks('GRACE'), wS = whatWorks('SUSPENDED');
eq('активна: работает всё', wA.every(w=>w.ok), true);
eq('grace: продажи идут', wG.find(w=>w.name.includes('Продажи'))?.ok, true);
eq('grace: отчёты закрыты', wG.find(w=>w.name.includes('Отчёты'))?.ok, false);
eq('suspended: продажи стоп', wS.find(w=>w.name.includes('Продажи'))?.ok, false);
eq('ВСЕГДА: закрытие смены', [wA,wG,wS].every(w=>w.find(x=>x.name.includes('Закрытие смены'))?.ok), true);
eq('ВСЕГДА: выгрузка своих данных', [wA,wG,wS].every(w=>w.find(x=>x.name.includes('выгрузка')||x.name.includes('Выгрузка'))?.ok), true);

console.log('── БИЛЛИНГ: отсрочка ──');
eq('первая — без вопросов', canRequestDeferral(null, D(19)).allowed, true);
eq('через полгода — можно', canRequestDeferral(new Date(2026,0,1), D(19)).allowed, true);
const recent = canRequestDeferral(new Date(2026,5,1), D(19));  // 48 дней назад
eq('недавно давали — нельзя', recent.allowed, false);
eq('объяснено когда можно', recent.reason.includes('Следующая'), true);

console.log('── ДИЛЕР: портфель ──');
const C=(o:Partial<DealerClient>):DealerClient=>({accountId:'c', name:'Кафе', status:'ACTIVE',
  monthlyPayment:1800000, signedAt:D(1), ...o});
const clients: DealerClient[] = [
  C({accountId:'1', name:'Дастархан', status:'ACTIVE', monthlyPayment:1800000}),
  C({accountId:'2', name:'Донер Хан', status:'ACTIVE', monthlyPayment:1200000}),
  C({accountId:'3', name:'Кофейня', status:'PAST_DUE', monthlyPayment:2600000}),
  C({accountId:'4', name:'Новый', status:'TRIAL', trialEndsAt:D(22)}),
  C({accountId:'5', name:'Старый', status:'CHURNED'}),
];
const p = dealerPortfolio(clients, 18, D(19));
eq('всего 5 клиентов', p.totalClients, 5);
eq('платят 3 (вкл. просрочку)', p.payingCount, 3);
eq('на пробном 1', p.trialCount, 1);
eq('пробный кончается на неделе', p.trialSoon, 1);
eq('ушёл 1', p.churnedCount, 1);
eq('база 56 000', p.monthlyBase, 1800000+1200000+2600000);
eq('комиссия 18% = 10 080', p.monthlyCommission, Math.round((1800000+1200000+2600000)*18/100));
eq('комиссия по клиенту', clientCommission(clients[0], 18), Math.round(1800000*0.18));
eq('с пробного комиссии нет', clientCommission(clients[3], 18), 0);
eq('с ушедшего комиссии нет', clientCommission(clients[4], 18), 0);
// риск
const risk = commissionAtRisk(clients, 18);
eq('под риском 1 клиент', risk.clients, 1);
eq('под риском комиссия с 26 000', risk.amount, Math.round(2600000*0.18));

console.log('── ДИЛЕР: действия по клиентам ──');
eq('пробный кончается через 3 дн — звонить', clientAction(clients[3], D(19)).urgency, 'high');
eq('пробный с запасом — помочь', clientAction(C({status:'TRIAL', trialEndsAt:D(30)}), D(19)).urgency, 'medium');
eq('не оплатил — напомнить', clientAction(clients[2], D(19)).label, 'Не оплатил — напомнить');
eq('платит — действий нет', clientAction(clients[0], D(19)).urgency, 'none');
eq('ушёл — узнать причину', clientAction(clients[4], D(19)).label.includes('причину'), true);

console.log('── ДИЛЕР: выплаты ──');
eq('до 5-го — выплата в этом месяце', nextPayoutDate(new Date(2026,6,3)).getMonth(), 6);
eq('после 5-го — в следующем', nextPayoutDate(new Date(2026,6,19)).getMonth(), 7);
eq('ровно 5-го — уже следующий', nextPayoutDate(new Date(2026,6,5)).getMonth(), 7);
const accruals: MonthlyAccrual[] = [
  {month:'2026-07', paymentsCount:3, base:5600000, commission:1008000, status:'SCHEDULED'},
  {month:'2026-06', paymentsCount:3, base:5000000, commission:900000, status:'PAID'},
  {month:'2026-05', paymentsCount:2, base:3000000, commission:540000, status:'PAID'},
];
const f = payoutForecast(accruals, 1008000);
eq('к выплате — невыплаченное', f.ready, 1008000);
eq('выплачено за полгода', paidTotal(accruals), 900000+540000);
eq('рост комиссии +12%', commissionGrowthPct(1008000, 900000), 12);
eq('падение комиссии', commissionGrowthPct(900000, 1008000), -10.7);
eq('первый месяц — без процента', commissionGrowthPct(1000, 0), null);

console.log('── ДИЛЕР: демо-стенды ──');
const S=(o:Partial<DemoStand>):DemoStand=>({id:'s', issuedTo:'Кафе', issuedAt:D(1), expiresAt:D(25), ...o});
eq('сконвертировался', demoStandState(S({convertedAccountId:'a1'}), D(19)).state, 'converted');
eq('активен', demoStandState(S({}), D(19)).state, 'active');
eq('истекает через 2 дня', demoStandState(S({expiresAt:D(21)}), D(19)).state, 'expiring');
eq('истекающий торопит', demoStandState(S({expiresAt:D(21)}), D(19)).label.includes('закрывать сделку'), true);
eq('истёк', demoStandState(S({expiresAt:D(10)}), D(19)).state, 'expired');
eq('конверсия стендов 50%', demoConversionRate([S({convertedAccountId:'a'}), S({})]), 50);
eq('нет стендов — 0%', demoConversionRate([]), 0);

console.log('── ДИЛЕР: аккредитация ──');
const steps = accreditationSteps({company:true, contract:true});
eq('5 шагов', steps.length, 5);
const ap = accreditationProgress(steps);
eq('прогресс 40%', ap.pct, 40);
eq('не аккредитован', ap.accredited, false);
eq('следующий шаг — NDA', ap.nextStep?.id, 'nda');
eq('всё готово → аккредитован', accreditationProgress(accreditationSteps(
  {company:true,contract:true,nda:true,training:true,bank:true})).accredited, true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

import React from 'react';
import { renderToString } from 'react-dom/server';
import { platformDashboard, healthScore, rescueQueue, nextInvoice, invoiceStatusAt,
  payFromBalance, annualOffer, dunningPlan, dueDunningSteps, issueSos, sosActive,
  startImpersonation, dealerPayout, SOS_REASONS, SosError } from '../platform.viewmodels.ts';
import type { AccountRow, Invoice, SosCode, DealerRow } from '../platform.viewmodels.ts';
import { PlatformDashboard, AccountsScreen, AccountCard, DealersScreen, DunningScreen } from '../AdminScreens.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,120)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as SosError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const D=(d:number)=>new Date(2026,6,d,12,0);
const now=D(19);

const A=(p:Partial<AccountRow>):AccountRow=>({
  accountId:'a1', name:'Кафе Дастархан', city:'Алматы', vertical:'CAFE', status:'ACTIVE',
  locations:1, mrr:1500000, periodEnd:D(30), checksLast7d:250, shiftsClosedLast7d:7,
  menuItems:40, balance:0, lastCheckAt:D(19), ...p});

// ═══ Дашборд платформы ═══
const accs = [
  A({}),
  A({accountId:'a2', name:'Донер Хаус', mrr:1000000, status:'PAST_DUE', lastCheckAt:D(18), checksLast7d:120}),
  A({accountId:'a3', name:'Салон Айна', vertical:'SALON', status:'TRIAL', mrr:0, menuItems:3, checksLast7d:2, lastCheckAt:D(19)}),
  A({accountId:'a4', name:'Бильярд Шар', status:'ACTIVE', mrr:2000000, periodEnd:D(24), lastCheckAt:D(10), checksLast7d:0, shiftsClosedLast7d:0}),
];
const d = platformDashboard(accs, now);
eq('MRR = 15000+10000+20000', d.mrr, 4500000);
eq('платящих 3 (active+past_due)', d.payingAccounts, 3);
eq('на пробном 1', d.trials, 1);
eq('просрочка 1 на 10000', [d.pastDue, d.pastDueMoney], [1, 1000000]);
eq('продление ≤7 дней: a4 (24.07)', d.expiringSoon, 1);
eq('ARPU 45000/3', d.arpu, 1500000);

// ═══ Health-score (наша добавка) ═══
eq('здоровый клиент 100', healthScore(A({}), now).score, 100);
const dying = healthScore(A({lastCheckAt:D(10), checksLast7d:0, shiftsClosedLast7d:0}), now);
eq('9 дней без продаж → dying', dying.level, 'dying');
eq('причина названа', dying.reasons.some(r=>r.includes('Нет продаж 9')), true);
eq('смены не закрываются — в причинах', dying.reasons.some(r=>r.includes('Смены')), true);
// продаёт много, меню из 2 позиций (кофейня) — ЗДОРОВ, штрафа нет
eq('киоск с 2 позициями и 250 чеками — здоров', healthScore(A({menuItems:2}), now).score, 100);
// а вот новичок с пустым меню и без продаж — сигнал незавершённой настройки
const empty = healthScore(A({menuItems:2, status:'TRIAL', checksLast7d:2}), now);
eq('пробный: −20 меню −20 не начал продавать', empty.score, 60);
eq('пробный с пустым меню → watch', empty.level, 'watch');
eq('причина названа как настройка', empty.reasons.some(r=>r.includes('настройка не закончена')), true);
eq('пробный без продаж помечен отдельно', empty.reasons.some(r=>r.includes('не начал продавать')), true);
// пробный, который РАЗОШЁЛСЯ — здоров
eq('активный пробный (60 чеков, меню 30) — здоров',
  healthScore(A({status:'TRIAL', checksLast7d:60, menuItems:30}), now).score, 100);
// очередь спасения: дорогие и умирающие первыми
const q = rescueQueue(accs, now);
eq('в спасение попал бильярд (20000, нет продаж)', q[0].row.accountId, 'a4');
eq('здоровые не в очереди', q.some(x=>x.row.accountId==='a1'), false);

// ═══ Счета: предоплата (исправление Paloma) ═══
eq('за 20 дней до конца счёта нет', nextInvoice({accountId:'a1', mrr:1500000, periodEnd:D(30)}, 1, D(5)), null);
const inv = nextInvoice({accountId:'a1', mrr:1500000, periodEnd:D(24)}, 7, now)!;
eq('за 5 дней — счёт выставлен', inv.status, 'ISSUED');
eq('номер с ведущими нулями', inv.number, 'DSTR-00007');
eq('срок оплаты = старт периода', inv.dueAt.getTime(), D(24).getTime());
eq('после срока — OVERDUE', invoiceStatusAt(inv, D(26)), 'OVERDUE');
eq('оплаченный не меняется', invoiceStatusAt({...inv, status:'PAID'}, D(99)), 'PAID');

// ═══ Баланс (Kaspi-модель Paloma) ═══
eq('хватило баланса', payFromBalance(2000000, inv), {ok:true, newBalance:500000});
eq('не хватило — показать недостачу', payFromBalance(1000000, inv), {ok:false, newBalance:1000000, short:500000});

// ═══ Годовая предоплата кнопкой (у Paloma — переписка) ═══
const an = annualOffer(1500000);
eq('год со скидкой 17%', [an.total, an.saved], [14940000, 3060000]);

// ═══ Dunning ═══
eq('5 шагов напоминаний', dunningPlan(1500000).length, 5);
eq('за 7 дней — email', dueDunningSteps(D(26), D(19), 1500000)[0].channel, 'email');
eq('в день X — sms', dueDunningSteps(D(19), D(19), 1500000)[0].channel, 'sms');
eq('+3 дня — telegram', dueDunningSteps(D(16), D(19), 1500000)[0].channel, 'telegram');
eq('сумма подставлена в текст', dunningPlan(1500000)[0].text.includes('15 000 ₸'), true);
eq('в неурочный день — тишина', dueDunningSteps(D(15), D(19), 1500000), []);

// ═══ SOS-код (r_keeper-механика) ═══
throws('без причины — отказ', ()=>issueSos('a1','','Магжан',now,[]), 'REASON_REQUIRED');
throws('срок >5 дней — отказ', ()=>issueSos('a1',SOS_REASONS[0],'Магжан',now,[],7), 'BAD_TERM');
const sos = issueSos('a1', SOS_REASONS[3], 'Магжан', now, []);
eq('код выдан с префиксом', sos.code.startsWith('SOS-'), true);
eq('истекает через 5 дней', Math.round((sos.expiresAt.getTime()-now.getTime())/86400000), 5);
eq('активен сейчас', sosActive(sos, now), true);
eq('через 6 дней не активен', sosActive(sos, D(25)), false);
const hist: SosCode[] = [
  {...sos, issuedAt:D(1)}, {...sos, code:'SOS-2', issuedAt:D(10)},
];
throws('3-й код за квартал — отказ', ()=>issueSos('a1',SOS_REASONS[0],'М',now,hist), 'LIMIT');
eq('другому аккаунту можно', issueSos('a9',SOS_REASONS[0],'М',now,hist).accountId, 'a9');

// ═══ Impersonation ═══
throws('вход без причины — отказ', ()=>startImpersonation('a1','support','ok',now), 'REASON_REQUIRED');
const imp = startImpersonation('a1','support','Разбор жалобы на расхождение кассы', now);
eq('по умолчанию только чтение', imp.readOnly, true);
eq('срок 60 минут', (imp.expiresAt.getTime()-now.getTime())/60000, 60);

// ═══ Дилеры: recurring только с живых ═══
const dealer: DealerRow = {dealerId:'d1', name:'ИП Серик', region:'Шымкент', commissionPct:20, accounts:['a1','a2','a4']};
const p = dealerPayout(dealer, accs);
eq('база только ACTIVE (a1+a4, без просрочки a2)', p.base, 3500000);
eq('комиссия 20%', p.commission, 700000);
eq('живых клиентов 2', p.alive, 2);

// ═══ ЖИВОЙ РЕНДЕР ═══
const h1 = clean(renderToString(<PlatformDashboard accounts={accs} now={now} />));
eq('дашборд: MRR виден', h1.includes('45 000'), true);
eq('дашборд: просрочка под угрозой', h1.includes('под угрозой'), true);
eq('дашборд: очередь спасения с причиной', h1.includes('Нет продаж'), true);

const h2 = clean(renderToString(<AccountsScreen accounts={accs} now={now} onOpen={()=>{}} />));
eq('список: все 4 клиента', (h2.match(/adm-row/g)||[]).length, 4);
eq('список: статусы по-русски', h2.includes('Просрочка') && h2.includes('Пробный'), true);

const invoices: Invoice[] = [inv];
const h3 = clean(renderToString(<AccountCard account={accs[3]} invoices={invoices}
  sosHistory={[]} now={now} onIssueSos={()=>{}} onImpersonate={()=>{}} onExtend={()=>{}} />));
eq('карточка: предупреждения здоровья', h3.includes('Нет продаж'), true);
eq('карточка: годовое предложение со скидкой', h3.includes('Год за'), true);
eq('карточка: Kaspi-инструкция с номером аккаунта', h3.includes('Kaspi') && h3.includes('a4'), true);
eq('карточка: SOS с выбором причины', SOS_REASONS.every(r=>h3.includes(r)), true);
eq('карточка: вход как клиент только чтение', h3.includes('только чтение'), true);

const h4 = clean(renderToString(<DealersScreen dealers={[dealer]} accounts={accs} />));
eq('дилеры: комиссия 7 000 ₸', h4.includes('7 000'), true);
eq('дилеры: живых 2', h4.includes('<td>2</td>'), true);

const h5 = clean(renderToString(<DunningScreen amount={1500000} />));
eq('напоминания: 5 шагов на экране', (h5.match(/adm-day/g)||[]).length, 5);
eq('напоминания: день X подписан', h5.includes('день X'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

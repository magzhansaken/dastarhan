import { effectiveStatus, accessRights, renew, subscriptionPrice, proration,
  canAddTerminal, dealerCommission, demoConverted, ticketDueAt, shouldAutoEscalate,
  startTrial, PlatformError } from '../../../../../packages/shared/src/platform/platform.logic.ts';
import type { Sub } from '../../../../../packages/shared/src/platform/platform.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as PlatformError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};
const d=(s:string)=>new Date(s);

// ═══ Машина подписки: деградация ступенями ═══
const sub: Sub = { status:'ACTIVE', periodEnd:d('2026-07-31'), graceDays:7 };
eq('в периоде = ACTIVE', effectiveStatus(sub, d('2026-07-20')), 'ACTIVE');
eq('после периода, в grace = PAST_DUE', effectiveStatus(sub, d('2026-08-03')), 'PAST_DUE');
eq('grace истёк = SUSPENDED', effectiveStatus(sub, d('2026-08-10')), 'SUSPENDED');

// права по статусам: КАССА ПРОДАЁТ В PAST_DUE (чек обязан выйти!)
eq('PAST_DUE: касса продаёт, офис read-only',
   accessRights('PAST_DUE'), { posSell:true, posCloseShift:true, backoffice:'readonly' });
eq('SUSPENDED: продаж нет, но смену закрыть можно',
   accessRights('SUSPENDED'), { posSell:false, posCloseShift:true, backoffice:'billing_only' });

// продление: дни не сгорают
let s2 = renew(sub, d('2026-07-20'));           // оплатил заранее
eq('оплата заранее: +месяц ОТ КОНЦА периода', s2.periodEnd.toISOString().slice(0,10), '2026-08-31');
s2 = renew({...sub, periodEnd:d('2026-07-31')}, d('2026-08-05')); // оплатил в grace
eq('оплата в grace: +месяц от даты оплаты', s2.periodEnd.toISOString().slice(0,10), '2026-09-05');
eq('после оплаты снова ACTIVE', s2.status, 'ACTIVE');

// trial
const tr = startTrial(d('2026-07-19'));
eq('trial 14 дней', tr.trialEnd!.toISOString().slice(0,10), '2026-08-02');
eq('в trial статус TRIAL', effectiveStatus(tr, d('2026-07-25')), 'TRIAL');
eq('после trial без оплаты = SUSPENDED', effectiveStatus(tr, d('2026-08-05')), 'SUSPENDED');

// ═══ Цена и proration ═══
// Poster-формула: 15 000 тг/точка × 3 точки
eq('цена = тариф × точки', subscriptionPrice(1_500_000, 3), 4_500_000);
throws('0 точек нельзя', ()=>subscriptionPrice(1_500_000, 0), 'BAD_LOCATIONS');
// апгрейд посреди месяца: было 15 000, стало 25 000, осталось 15 из 30 дней
eq('доплата за апгрейд = 5000тг', proration(1_500_000, 2_500_000, 15, 30), { dueNow:500_000, creditNext:0 });
// даунгрейд: кредит на следующий период
eq('даунгрейд → кредит', proration(2_500_000, 1_500_000, 15, 30), { dueNow:0, creditNext:500_000 });

// лимиты тарифа
eq('терминал в лимите', canAddTerminal(1, 2), true);
eq('лимит исчерпан', canAddTerminal(2, 2), false);

// ═══ Дилеры ═══
// комиссия 20% от платежа 45 000тг — КАЖДЫЙ месяц (recurring)
eq('комиссия 20%', dealerCommission(4_500_000, 20), 900_000);
throws('комиссия >50% запрещена', ()=>dealerCommission(100, 60), 'BAD_PCT');
// конверсия демо
eq('оплатил до конца демо = засчитан', demoConverted(d('2026-08-01'), d('2026-07-28')), true);
eq('оплатил после = не демо-конверсия', demoConverted(d('2026-08-01'), d('2026-08-05')), false);

// ═══ Service Desk: SLA и авто-эскалация ═══
eq('critical SLA 2 часа', ticketDueAt(d('2026-07-19T10:00Z'), 'critical').toISOString(), '2026-07-19T12:00:00.000Z');
eq('normal SLA 24 часа', ticketDueAt(d('2026-07-19T10:00Z'), 'normal').toISOString(), '2026-07-20T10:00:00.000Z');
const tk = { level:'DEALER' as const, status:'OPEN', dueAt:d('2026-07-19T12:00Z') };
eq('просрочен у дилера → эскалация', shouldAutoEscalate(tk, d('2026-07-19T13:00Z')), true);
eq('в сроке → нет', shouldAutoEscalate(tk, d('2026-07-19T11:00Z')), false);
eq('уже у вендора → нет', shouldAutoEscalate({...tk, level:'VENDOR' as any}, d('2026-07-19T13:00Z')), false);
eq('решён → нет', shouldAutoEscalate({...tk, status:'RESOLVED'}, d('2026-07-19T13:00Z')), false);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

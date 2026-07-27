import { paidTotal, remainingDue, validateNewPayment, change, canCloseOrder, voidPayment,
  validateRefund, validateFiscalRequest, nextRetryDelayMs, planRetry, dueForRetry,
  terminalStart, terminalResolve, PayError } from './pay.ts';
import type { Pay, QueueItem, FiscalRequest } from './pay.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as PayError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};

// ═══ Смешанная оплата: заказ 10 000 тг = 1 000 000 тиын ═══
const total = 1_000_000;
let pays: Pay[] = [];
// карта 600 000
const card: Pay = { paymentId:'p1', kind:'CARD', amount:600_000, status:'PENDING' };
validateNewPayment(total, pays, card); pays.push({...card, status:'CAPTURED'});
eq('остаток после карты', remainingDue(total, pays), 400_000);
// карта не может превысить остаток (сдачи нет)
throws('безнал > остатка запрещён', ()=>validateNewPayment(total, pays, {paymentId:'x',kind:'CARD',amount:500_000,status:'PENDING'}), 'OVER_DUE');
// наличные: дали 500 000, к зачёту 400 000 → сдача 100 000
const cash: Pay = { paymentId:'p2', kind:'CASH', amount:400_000, tendered:500_000, status:'PENDING' };
validateNewPayment(total, pays, cash); pays.push({...cash, status:'CAPTURED'});
eq('сдача 1000 тг', change(pays[1]), 100_000);
eq('заказ можно закрыть', canCloseOrder(total, pays), true);
throws('оплата сверх оплаченного', ()=>validateNewPayment(total, pays, {paymentId:'p3',kind:'CASH',amount:100,tendered:100,status:'PENDING'}), 'ALREADY_PAID');
// наличными получено меньше зачёта — ошибка
throws('tendered < amount', ()=>validateNewPayment(500, [], {paymentId:'z',kind:'CASH',amount:500,tendered:300,status:'PENDING'}), 'TENDERED_LOW');

// отмена частичной оплаты (QuickResto)
let pays2: Pay[] = [{ paymentId:'a', kind:'CARD', amount:300, status:'CAPTURED' }];
pays2 = voidPayment(pays2, 'a');
eq('VOIDED не считается оплатой', paidTotal(pays2), 0);
throws('void несуществующего', ()=>voidPayment(pays2,'zz'), 'NOT_FOUND');

// возвраты: частичный, не больше остатка, причина обязательна
const cap: Pay = { paymentId:'r', kind:'CARD', amount:1000, status:'CAPTURED' };
validateRefund(cap, 0, 400, 'Брак блюда'); pass++; console.log('  ✓ частичный возврат валиден');
throws('возврат сверх остатка', ()=>validateRefund(cap, 400, 700, 'x'), 'BAD_AMOUNT');
throws('возврат без причины', ()=>validateRefund(cap, 0, 100, ''), 'REASON_REQUIRED');

// ═══ Фискальный чек: суммы обязаны сходиться ═══
const okReq: FiscalRequest = {
  op:'SELL', total:350_000,
  items:[{name:'Плов', qty:1, price:250_000, vatRate:16},{name:'Чай', qty:2, price:50_000, vatRate:16}],
  payments:[{kind:'CASH', amount:350_000}],
};
validateFiscalRequest(okReq); pass++; console.log('  ✓ валидный чек проходит');
throws('позиции ≠ итог', ()=>validateFiscalRequest({...okReq, total:340_000, payments:[{kind:'CASH',amount:340_000}]}), 'FISCAL_ITEMS_MISMATCH');
throws('оплаты ≠ итог', ()=>validateFiscalRequest({...okReq, payments:[{kind:'CASH',amount:300_000}]}), 'FISCAL_PAYS_MISMATCH');

// ═══ Очередь: ретраи с backoff, офлайн не блокирует продажу ═══
eq('backoff растёт', [nextRetryDelayMs(0),nextRetryDelayMs(1),nextRetryDelayMs(2)], [5000,30000,120000]);
let q: QueueItem = { id:'f1', attempts:0, status:'QUEUED', nextTryAt:0 };
q = planRetry(q, 1000, { success:false, retriable:true, errorCode:'NETWORK' });
eq('сеть → ретрай запланирован', [q.status, q.attempts, q.nextTryAt], ['QUEUED', 1, 1000+30000]);
q = planRetry(q, 2000, { success:true, fiscalNumber:'123' });
eq('успех → SENT', q.status, 'SENT');
let q2: QueueItem = { id:'f2', attempts:0, status:'QUEUED', nextTryAt:0 };
q2 = planRetry(q2, 0, { success:false, retriable:false, errorCode:'412', errorText:'Смена > 24ч' });
eq('логическая ошибка → ERROR без ретраев', q2.status, 'ERROR');
const due = dueForRetry([{id:'a',attempts:1,status:'QUEUED',nextTryAt:100},{id:'b',attempts:1,status:'QUEUED',nextTryAt:9999},{id:'c',attempts:0,status:'SENT',nextTryAt:0}], 500);
eq('к ретраю только созревшие QUEUED', due.map(d=>d.id), ['a']);

// ═══ Kaspi-терминал: машина состояний ═══
let ts = terminalStart(100_000);
eq('терминал ждёт карту', ts.phase, 'WAITING_CARD');
ts = terminalResolve(ts, { type:'approved', rrn:'RRN42' });
eq('одобрено с RRN', [ts.phase, ts.rrn], ['APPROVED','RRN42']);
throws('повторный resolve запрещён', ()=>terminalResolve(ts,{type:'declined'}), 'BAD_PHASE');
throws('нулевая сумма', ()=>terminalStart(0), 'BAD_AMOUNT');

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

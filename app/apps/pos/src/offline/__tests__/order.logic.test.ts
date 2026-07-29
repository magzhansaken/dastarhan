import { reduceOrder, orderTotals, totalsByGuest, expectedCash, shiftDiscrepancy,
  checkStopList, consumeStop, DomainError } from '../../../../../packages/shared/src/order/orderReducer.ts';
import type { OrderState, OrderEvent } from '../../../../../packages/shared/src/order/orderReducer.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w)||(typeof g==='number'&&Math.abs(g-w)<0.001);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as DomainError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};

// ═══ Полный сценарий: столик на двоих ═══
let s: OrderState | null = null;
const apply=(ev:OrderEvent)=>{s=reduceOrder(s,ev)};
apply({type:'order.opened', orderId:'o1', number:1, mode:'DINE_IN', tableId:'t5', guestsCount:2});
apply({type:'order.item.added', orderId:'o1', itemId:'i1', productId:'plov', name:'Плов', guestNo:1, qty:1, unitPrice:2500, modifiers:[]});
apply({type:'order.item.added', orderId:'o1', itemId:'i2', productId:'capp', name:'Капучино', guestNo:2, qty:2, unitPrice:1500,
  modifiers:[{optionId:'oat', name:'Овсяное', priceDelta:200}]});
apply({type:'order.item.added', orderId:'o1', itemId:'i3', productId:'tea', name:'Чай', guestNo:2, qty:1, unitPrice:800, modifiers:[]});

eq('subtotal: 2500 + 2×(1500+200) + 800', orderTotals(s!).subtotal, 2500+3400+800);
const byGuest = totalsByGuest(s!);
eq('счёт гостя 1', byGuest.get(1), 2500);
eq('счёт гостя 2', byGuest.get(2), 4200);

// частичная кухня: плов ушёл, кофе ещё нет (QR «отправить часть»)
apply({type:'order.kitchen.sent', orderId:'o1', itemIds:['i1']});
eq('плов SENT', s!.items[0].kitchenStatus, 'SENT');
eq('кофе ещё NEW', s!.items[1].kitchenStatus, 'NEW');

// количество после отправки менять нельзя
throws('qty после кухни запрещено', ()=>reduceOrder(s,{type:'order.item.qty_changed',orderId:'o1',itemId:'i1',qty:2}), 'ALREADY_SENT');
// а у неотправленного — можно
apply({type:'order.item.qty_changed', orderId:'o1', itemId:'i2', qty:1});
eq('qty кофе изменено', s!.items[1].qty, 1);

// удаление без причины — запрещено (след злоупотреблений)
throws('удаление без причины', ()=>reduceOrder(s,{type:'order.item.removed',orderId:'o1',itemId:'i3',reason:'',byUserId:'u1'}), 'REASON_REQUIRED');
apply({type:'order.item.removed', orderId:'o1', itemId:'i3', reason:'Гость передумал', byUserId:'u1'});
eq('чай удалён, из суммы ушёл', orderTotals(s!).subtotal, 2500+1700);

// переносы (QR): блюдо→гость, заказ→стол, официант
apply({type:'order.item.moved_to_guest', orderId:'o1', itemId:'i2', guestNo:1});
eq('кофе теперь у гостя 1', totalsByGuest(s!).get(1), 2500+1700);
throws('гость вне диапазона', ()=>reduceOrder(s,{type:'order.item.moved_to_guest',orderId:'o1',itemId:'i2',guestNo:7}), 'BAD_GUEST');
apply({type:'order.moved_to_table', orderId:'o1', tableId:'t9'});
eq('заказ переехал на стол 9', s!.tableId, 't9');
apply({type:'order.waiter_changed', orderId:'o1', waiterId:'w2'});
eq('официант сменён', s!.waiterId, 'w2');

// закрытие; после — операции запрещены
apply({type:'order.closed', orderId:'o1'});
throws('операции после закрытия', ()=>reduceOrder(s,{type:'order.item.added',orderId:'o1',itemId:'x',productId:'x',name:'x',guestNo:0,qty:1,unitPrice:1,modifiers:[]}), 'NOT_OPEN');

// takeout: стол недоступен
let t: OrderState | null = null;
t = reduceOrder(t, {type:'order.opened', orderId:'o2', number:2, mode:'TAKEOUT'});
throws('стол в навынос запрещён', ()=>reduceOrder(t,{type:'order.moved_to_table',orderId:'o2',tableId:'t1'}), 'NO_TABLE_MODE');

// ═══ Стоп-лист с остатком (Poster) ═══
const stop = new Map<string, number|null>([['plov', 3], ['fish', null]]);
eq('обычный товар свободен', checkStopList(stop,'tea',5), {ok:true});
eq('полный стоп', checkStopList(stop,'fish',1), {ok:false, reason:'STOPPED'});
eq('не хватает остатка', checkStopList(stop,'plov',5), {ok:false, reason:'NOT_ENOUGH', remaining:3});
eq('в пределах остатка ок', checkStopList(stop,'plov',2), {ok:true});
consumeStop(stop,'plov',2);
eq('остаток декрементирован', stop.get('plov'), 1);
consumeStop(stop,'plov',1);
eq('0 → полный стоп автоматически', stop.get('plov'), null);

// ═══ Смена: книжный vs фактический (Poster) ═══
const fin = { openingCash:20000, cashSales:150000, cashRefunds:5000, cashIn:10000, cashOut:30000 };
eq('книжный баланс', expectedCash(fin), 20000+150000+10000-30000-5000);
const d = shiftDiscrepancy(fin, 143000);
eq('недостача −2000', d.discrepancy, -2000);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

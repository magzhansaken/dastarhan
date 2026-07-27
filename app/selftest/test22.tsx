import React from 'react';
import { renderToString } from 'react-dom/server';
import { telLink, navLink, lateBadge, tripSummary, doorChangeHints, CourierApp, RETURN_REASONS } from './courier.tsx';
import type { CourierOrderVm } from './courier.tsx';
import { newTrip, assignToTrip, markDelivered } from './del.ts';
import type { Trip } from './del.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const at=(h:number,m=0)=>new Date(2026,6,19,h,m);

// ═══ Deep-links КЗ ═══
eq('tel: чистит формат', telLink('+7 (707) 123-45-67'), 'tel:+77071234567');
eq('навигатор по координатам — 2GIS deep link', navLink('x', 43.238, 76.945), 'dgis://2gis.ru/routeSearch/to/76.945,43.238');
eq('без координат — 2GIS поиск адреса', navLink('Абая 10').startsWith('https://2gis.kz/search/'), true);

// ═══ Просрочка ═══
eq('опоздание 12 мин', lateBadge(at(14,0), at(14,12)), 'опоздание 12 мин');
eq('в срок — null', lateBadge(at(14,30), at(14,12)), null);

// ═══ Сводка рейса (на готовой логике Этапа 7) ═══
let trip: Trip = newTrip('c1');
trip = assignToTrip(trip, 'o1', 'READY', 350000);
trip = assignToTrip(trip, 'o2', 'READY', 0);
trip = markDelivered(trip, 'o1');   // наличный вручён → долг 3500
const orders: CourierOrderVm[] = [
  { orderId:'o1', number:11, address:'Абая 10, кв 5', phone:'+77071234567', customerName:'Асель',
    items:[{name:'Плов',qty:2}], cashDue:350000, promisedAt:at(14,0), status:'DELIVERED' },
  { orderId:'o2', number:12, address:'Достык 88', phone:'+77017654321',
    items:[{name:'Бешбармак',qty:1}], cashDue:0, comment:'домофон 45В, злой пёс',
    promisedAt:at(14,40), status:'DISPATCHED' },
];
const s = tripSummary(orders, trip);
eq('вручить 1, вручено 1', [s.toDeliver, s.delivered], [1,1]);
eq('долг наличных 3500 живьём', s.cashDebt, 350000);
eq('наличных заказов не осталось', s.cashOrdersLeft, 0);

// ═══ Подсказки сдачи у двери ═══
eq('к 3500: с 5000/10000/20000', doorChangeHints(350000),
  [{note:500000,change:150000},{note:1000000,change:650000},{note:2000000,change:1650000}]);
eq('к 12000: 5000 отпадает', doorChangeHints(1200000).map(h=>h.note), [2000000]);

// ═══ Причины возврата ═══
eq('4 причины, включая «не отвечает»', [RETURN_REASONS.length, RETURN_REASONS[0]], [4,'Не отвечает на звонки']);

// ═══ ЖИВОЙ РЕНДЕР ═══
// довозим рейс: o2 (безнал) тоже вручён — долг остаётся 3500, кнопка сдачи должна появиться
const tripDone = markDelivered(trip, 'o2');
const ordersDone: CourierOrderVm[] = [orders[0], {...orders[1], status:'DELIVERED' as const}];
const h = clean(renderToString(<CourierApp courierName="Ербол" orders={ordersDone} trip={tripDone}
  now={at(14,12)} online={false}
  onDelivered={()=>{}} onReturned={()=>{}} onHandOverCash={()=>{}} />));
eq('долг в шапке 3 500 ₸', h.includes('Наличных у меня') && h.includes('3 500'), true);
eq('офлайн честно подписан', h.includes('Офлайн — данные сохранятся'), true);
eq('вручённый помечен ✓', h.includes('✓ вручено'), true);
eq('предоплаченный бейджем «оплачен»', h.includes('оплачен ✓'), true);
eq('адреса на месте', h.includes('Абая 10') && h.includes('Достык 88'), true);
eq('всё вручено + долг → кнопка сдачи', h.includes('Сдать 3 500 ₸ на кассу'), true);

// заказ раскрыт: — рендерю с openId через клик невозможно в SSR; проверяю экран наличных отдельно
const h2 = clean(renderToString(<CourierApp courierName="Е" orders={[{...orders[1], cashDue:350000, status:'DISPATCHED'}]} trip={newTrip('c')}
  now={at(14,50)} online={true}
  onDelivered={()=>{}} onReturned={()=>{}} onHandOverCash={()=>{}} />));
eq('просрочка на карточке', h2.includes('опоздание 10 мин'), true);
eq('наличный бейдж с суммой', h2.includes('💵'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

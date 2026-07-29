import { canTransition, transition, isOverdue, pointInPolygon, resolveZone,
  newTrip, assignToTrip, markDelivered, courierDebt, returnCash, closeTrip,
  shouldNotify, DeliveryError } from '../../../../../packages/shared/src/delivery/delivery.logic.ts';
import type { Zone, Trip } from '../../../../../packages/shared/src/delivery/delivery.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as DeliveryError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};

// ═══ Машина статусов (r_keeper: строгий порядок) ═══
eq('NEW→CONFIRMED ок', canTransition('NEW','CONFIRMED'), true);
eq('NEW→READY прыжок запрещён', canTransition('NEW','READY'), false);
eq('назад запрещено', canTransition('READY','COOKING'), false);
eq('отмена до отправки ок', canTransition('COOKING','CANCELLED'), true);
eq('отмена В ПУТИ запрещена (только возврат)', canTransition('DISPATCHED','CANCELLED'), false);
eq('возврат из пути ок', canTransition('DISPATCHED','RETURNED'), true);
eq('возврат из NEW запрещён', canTransition('NEW','RETURNED'), false);
throws('transition бросает', ()=>transition('NEW','DELIVERED'), 'BAD_TRANSITION');

// просрочка
eq('в пути после срока = просрочен', isOverdue(new Date('2026-07-19T12:00Z'), new Date('2026-07-19T12:30Z'), 'DISPATCHED'), true);
eq('доставлен = не просрочен', isOverdue(new Date('2026-07-19T12:00Z'), new Date('2026-07-19T12:30Z'), 'DELIVERED'), false);

// ═══ Зоны: полигоны, пересечения (r_keeper) ═══
// zoneA: центр, платно 500тг, бесплатно от 5000тг, мин 2000тг, ETA 40
// zoneB: шире, платно 1000тг, мин 3000тг, ETA 60 — пересекается с A
const A: Zone = { id:'A', polygon:[[0,0],[0,10],[10,10],[10,0]], minOrder:200_000, deliveryFee:50_000, freeFrom:500_000, etaMinutes:40, priority:1 };
const B: Zone = { id:'B', polygon:[[-5,-5],[-5,15],[15,15],[15,-5]], minOrder:300_000, deliveryFee:100_000, freeFrom:null, etaMinutes:60, priority:0 };
eq('точка в A', pointInPolygon([5,5], A.polygon), true);
eq('точка вне A', pointInPolygon([12,5], A.polygon), false);

// в пересечении, заказ 4000тг → зона A (дешевле), фи 500
let r = resolveZone([5,5], 400_000, [A,B]);
eq('пересечение → лучшая для клиента', (r as any).zone.id, 'A');
eq('фи 500тг', (r as any).fee, 50_000);
// заказ 6000тг → A бесплатно
r = resolveZone([5,5], 600_000, [A,B]);
eq('бесплатно от суммы', (r as any).fee, 0);
// точка только в B (вне A), заказ 4000
r = resolveZone([12,5], 400_000, [A,B]);
eq('только B', (r as any).zone.id, 'B');
// вне всех зон
eq('вне зон', resolveZone([50,50], 900_000, [A,B]), { error:'OUT_OF_ZONE' });
// минималка: в пересечении, заказ 2500 → A подходит (мин 2000), B нет
r = resolveZone([5,5], 250_000, [A,B]);
eq('минималка A выполнена', (r as any).zone.id, 'A');
// заказ 1500 → ни одна: подсказка ближайшей минималки 2000
eq('до минималки не дотянул', resolveZone([5,5], 150_000, [A,B]), { error:'MIN_ORDER', needed:200_000 });

// ═══ Рейс курьера и расчёт наличных (r_keeper) ═══
let trip: Trip = newTrip('c1');
trip = assignToTrip(trip, 'o1', 'READY', 350_000);  // наличный заказ 3500тг
trip = assignToTrip(trip, 'o2', 'READY', 0);        // безнал (Kaspi предоплата)
throws('несобранный в рейс нельзя', ()=>assignToTrip(trip,'o3','COOKING',100), 'NOT_READY');
eq('в рейсе 2, оба DISPATCHED', trip.orders.map(o=>o.status), ['DISPATCHED','DISPATCHED']);

trip = markDelivered(trip, 'o1');
eq('наличные у курьера 3500тг', trip.cashCollected, 350_000);
eq('долг курьера 3500тг', courierDebt(trip), 350_000);
throws('закрыть рейс с заказом в пути нельзя', ()=>closeTrip(trip), 'ORDERS_IN_FLIGHT');
trip = markDelivered(trip, 'o2');
throws('закрыть с долгом нельзя', ()=>closeTrip(trip), 'DEBT_NOT_ZERO');
throws('сдать больше долга нельзя', ()=>returnCash(trip, 400_000), 'OVER_DEBT');
trip = returnCash(trip, 350_000);
eq('долг погашен', courierDebt(trip), 0);
trip = closeTrip(trip);
eq('рейс закрыт', trip.closed, true);
throws('в закрытый рейс нельзя', ()=>assignToTrip(trip,'o9','READY',1), 'TRIP_CLOSED');

// ═══ Вебхуки (подписка на статусы) ═══
eq('пустая подписка = все статусы', shouldNotify([], 'DELIVERED'), true);
eq('подписан на DELIVERED', shouldNotify(['DELIVERED'], 'DELIVERED'), true);
eq('не подписан на COOKING', shouldNotify(['DELIVERED'], 'COOKING'), false);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

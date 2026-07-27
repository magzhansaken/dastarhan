import React from 'react';
import { renderToString } from 'react-dom/server';
import { validateReservation, tableReservationBadge, detectNoShows, guestRiskNote,
  reservationGrid, ReservationsScreen, ReservationError } from './resv.tsx';
import type { Reservation } from './resv.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as ReservationError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};
const at=(h:number,m=0)=>new Date(2026,6,19,h,m);

const R = (p: Partial<Reservation>): Reservation => ({
  id:'r1', tableId:'t1', startAt:at(19), endAt:at(21), guestPhone:'+77071234567',
  guestName:'Асель', persons:4, status:'BOOKED', ...p });

// ═══ Валидации ═══
const existing = [R({})];
validateReservation({tableId:'t1', startAt:at(21), endAt:at(23), persons:2}, 4, existing);
pass++; console.log('  ✓ встык после брони — ок');
throws('пересечение поймано', ()=>validateReservation(
  {tableId:'t1', startAt:at(20), endAt:at(22), persons:2}, 4, existing), 'OVERLAP');
validateReservation({tableId:'t2', startAt:at(20), endAt:at(22), persons:2}, 4, existing);
pass++; console.log('  ✓ другой стол — свободно');
throws('вместимость: 6 на 4-местный', ()=>validateReservation(
  {tableId:'t2', startAt:at(12), endAt:at(13), persons:6}, 4, []), 'OVER_CAPACITY');
throws('конец раньше начала', ()=>validateReservation(
  {tableId:'t2', startAt:at(13), endAt:at(12), persons:2}, 4, []), 'BAD_RANGE');
// отменённая бронь не блокирует
validateReservation({tableId:'t1', startAt:at(19), endAt:at(21), persons:2}, 4,
  [R({status:'CANCELLED'})]);
pass++; console.log('  ✓ отменённая не блокирует');

// ═══ «Скоро бронь» на карте зала ═══
eq('за 40 мин — reserved-soon с временем', tableReservationBadge('t1',[R({})],at(18,20)),
  {kind:'reserved-soon', at:'19:00', name:'Асель'});
eq('за 2 часа — ничего', tableReservationBadge('t1',[R({})],at(17,0)).kind, null);
eq('во время брони — reserved-now', tableReservationBadge('t1',[R({})],at(19,30)),
  {kind:'reserved-now', name:'Асель'});
eq('другой стол чист', tableReservationBadge('t9',[R({})],at(18,30)).kind, null);

// ═══ No-show ═══
eq('19:25 — ещё grace (20 мин)', detectNoShows([R({})], at(19,15)), []);
eq('19:25+ — no-show', detectNoShows([R({})], at(19,25)), ['r1']);
eq('севший гость не no-show', detectNoShows([R({status:'SEATED'})], at(20,0)), []);
eq('прогульщик 3 раза — предупреждение', guestRiskNote(3)?.includes('депозит'), true);
eq('1 раз — без предупреждения', guestRiskNote(1), null);

// ═══ Шахматка ═══
const grid = reservationGrid(
  [{id:'t1',name:'1'},{id:'t2',name:'2'}],
  [R({})], at(0), 18, 23);
eq('часы 18..22', grid.hours, [18,19,20,21,22]);
eq('бронь занимает 19 и 20', grid.rows[0].cells.filter(c=>c.res).map(c=>c.hour), [19,20]);
eq('21:00 свободен (endAt эксклюзивен)', grid.rows[0].cells.find(c=>c.hour===21)!.res, null);
eq('стол 2 весь свободен', grid.rows[1].cells.every(c=>!c.res), true);

// ═══ ЖИВОЙ РЕНДЕР ═══
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const h = clean(renderToString(<ReservationsScreen
  day={at(0)} now={at(19,30)}
  tables={[{id:'t1',name:'1',seats:4},{id:'t2',name:'2',seats:2}]}
  reservations={[R({}), R({id:'r2', tableId:'t2', startAt:at(18), endAt:at(19), guestName:'Ербол', persons:2, depositAmount:500000})]}
  onSeat={()=>{}} onCancel={()=>{}} onNew={()=>{}} />));
eq('шахматка отрисована', h.includes('res-grid'), true);
eq('чип брони с именем и персонами', h.includes('Асель') && h.includes('4ч'), true);
eq('депозит помечен 💰', h.includes('💰'), true);
eq('no-show алерт (Ербол просрочен)', h.includes('авто-освобождение'), true);
eq('кнопки Пришли/Отмена', h.includes('Пришли') && h.includes('Отмена'), true);
eq('занятая ячейка классом booked', h.includes('cell-booked'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

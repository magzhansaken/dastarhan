import { ean13CheckDigit, validateEan13, parseWeightBarcode, weightPrice, makeWeightBarcode,
  tariffAt, billSession, overlaps, validateAppointment, freeSlots, VerticalError } from './vert.ts';
import type { Tariff } from './vert.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};
const throws=(n:string,fn:()=>void,code:string)=>{try{fn();fail++;console.log(`  ✗ ${n}: не бросил`);}catch(e){(e as VerticalError).code===code?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: код ${(e as any).code}`));}};

// ═══ МАГАЗИН: весовые штрихкоды EAN-13 ═══
// генерация → разбор туда-обратно
const bc = makeWeightBarcode('123', 550);
eq('сгенерирован валидный EAN-13', validateEan13(bc), true);
eq('префикс 22 + PLU 00123 + вес 00550', bc.slice(0,12), '220012300550');
const parsed = parseWeightBarcode(bc);
eq('разбор: PLU и вес', parsed, { plu:'00123', weightGrams:550 });
// цена: 550 г лосося по 12 000 тг/кг
eq('цена веса: 550г × 12000тг/кг', weightPrice(550, 1_200_000), 660_000);
// обычный штрихкод — не весовой
eq('обычный код → null', parseWeightBarcode('4870001234565'.slice(0,12) + String(ean13CheckDigit('487000123456'))), null);
// битая чек-цифра
const bad = bc.slice(0,12) + String((+bc[12]+1)%10);
eq('битая чек-цифра → null', parseWeightBarcode(bad), null);
throws('PLU длиннее 5', ()=>makeWeightBarcode('123456', 100), 'BAD_PLU');
throws('вес за пределами', ()=>makeWeightBarcode('123', 100000), 'BAD_WEIGHT');

// ═══ БИЛЬЯРД: тарифные окна ═══
// дневной 2000тг/ч (10:00–18:00), вечерний 3000тг/ч (18:00–02:00), все дни
const tariffs: Tariff[] = [
  { daysMask:127, fromMin:10*60, toMin:18*60, pricePerHour:200_000 },
  { daysMask:127, fromMin:18*60, toMin:2*60,  pricePerHour:300_000 },
];
eq('12:00 — дневной', tariffAt(tariffs, 2, 12*60)?.pricePerHour, 200_000);
eq('20:00 — вечерний', tariffAt(tariffs, 2, 20*60)?.pricePerHour, 300_000);
eq('01:00 — вечерний (через полночь)', tariffAt(tariffs, 3, 60)?.pricePerHour, 300_000);
eq('05:00 — закрыто', tariffAt(tariffs, 2, 5*60), null);

// сессия 17:00–19:00 = 60 мин дневного + 60 мин вечернего = 2000+3000 = 5000тг
const wed = (h:number,m=0)=>new Date(2026,6,15,h,m); // среда 15.07.2026
let bill = billSession(wed(17), wed(19), tariffs);
eq('пересечение окон: 120 мин', bill.billedMinutes, 120);
eq('сумма 2000+3000', bill.amount, 500_000);
eq('разбивка по тарифам', bill.breakdown.map(b=>b.minutes), [60,60]);

// пауза: 18:00–18:30 перерыв → вечерних минут 30, сумма 2000+1500=3500
bill = billSession(wed(17), wed(19), tariffs, [{from:wed(18), to:wed(18,30)}]);
eq('пауза вычтена: 90 мин', bill.billedMinutes, 90);
eq('сумма с паузой 3500тг', bill.amount, 350_000);

// минимум 30 мин: сыграли 12 минут → счёт за 30
bill = billSession(wed(12), wed(12,12), tariffs);
eq('минимум 30 мин', bill.billedMinutes, 30);
eq('30 мин дневного = 1000тг', bill.amount, 100_000);

// шаг 5 мин: 43 минуты → 45
bill = billSession(wed(12), wed(12,43), tariffs);
eq('округление к шагу: 45', bill.billedMinutes, 45);
throws('конец раньше начала', ()=>billSession(wed(19), wed(17), tariffs), 'BAD_RANGE');

// ═══ САЛОН: записи ═══
const sched = [{ dow:2, fromMin:9*60, toMin:18*60 }]; // мастер: среда 9–18
const busy = [{ startAt:wed(11), endAt:wed(12) }];
validateAppointment({ startAt:wed(14), endAt:wed(15) }, sched, busy);
pass++; console.log('  ✓ запись в свободное время ок');
throws('double-booking', ()=>validateAppointment({startAt:wed(11,30), endAt:wed(12,30)}, sched, busy), 'DOUBLE_BOOKING');
throws('вне графика мастера', ()=>validateAppointment({startAt:wed(19), endAt:wed(20)}, sched, busy), 'OUT_OF_SCHEDULE');
// пересечения краями НЕ конфликт (12:00 конец = 12:00 начало)
validateAppointment({ startAt:wed(12), endAt:wed(13) }, sched, busy);
pass++; console.log('  ✓ встык к занятому — ок');

// свободные слоты: услуга 60 мин, сетка 60 — из 9..18 минус занятый 11–12
const slots = freeSlots(wed(0), sched, busy, 60, 60);
eq('слотов 8 (9 часов минус занятый)', slots.length, 8);
eq('слота 11:00 нет', slots.some(s=>s.startAt.getHours()===11), false);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

import React from 'react';
import { renderToString } from 'react-dom/server';
import { urgency, kdsTickets, batchSummary, kitchenSpeed, pushRecall, KdsScreen, TARGET_MIN,
  KT, kt, itemStatusLabel } from './kds.tsx';
import type { KdsTicketIn } from './kds.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const at=(m:number)=>new Date(2026,6,19,14,m);
const now = at(30);

// ═══ Пороги по каналам (наша добавка) ═══
eq('самовывоз: цель 10 мин', TARGET_MIN.TAKEOUT, 10);
eq('7 мин самовывоза = warn (70%)', urgency(at(23),'TAKEOUT',now).level, 'warn');
eq('11 мин самовывоза = late', urgency(at(19),'TAKEOUT',now).level, 'late');
eq('11 мин зала = warn (цель 15)', urgency(at(19),'DINE_IN',now).level, 'warn');
eq('11 мин доставки = ok (цель 20)', urgency(at(19),'DELIVERY',now).level, 'ok');

// ═══ Тикеты: FIFO, цеха, готовые в конец ═══
const tickets: KdsTicketIn[] = [
  { orderId:'o1', number:1, mode:'DINE_IN', tableName:'5', items:[
    { itemId:'i1', orderId:'o1', productId:'plov', name:'Плов', qty:2, modifiers:[], course:1, station:'hot', kitchenStatus:'COOKING', sentAt:at(10) },
    { itemId:'i2', orderId:'o1', productId:'tea', name:'Чай', qty:1, modifiers:[], course:1, station:'bar', kitchenStatus:'SENT', sentAt:at(10) },
  ]},
  { orderId:'o2', number:2, mode:'TAKEOUT', items:[
    { itemId:'i3', orderId:'o2', productId:'plov', name:'Плов', qty:5, modifiers:['без лука'], course:1, station:'hot', kitchenStatus:'SENT', sentAt:at(5) },
  ]},
  { orderId:'o3', number:3, mode:'DINE_IN', items:[
    { itemId:'i4', orderId:'o3', productId:'salad', name:'Салат', qty:1, modifiers:[], course:1, station:'cold', kitchenStatus:'COOKED', sentAt:at(0) },
  ]},
];
const vms = kdsTickets(tickets, null, now);
eq('FIFO: №2 (05) раньше №1 (10)', vms.slice(0,2).map(v=>v.number), [2,1]);
eq('готовый целиком №3 — в конец', vms[2].number, 3);
eq('№3 помечен allCooked', vms[2].allCooked, true);
eq('№2: 25 мин = late', [vms[0].minutes, vms[0].level], [25,'late']);
// цех hot: у №1 остаётся только плов
const hot = kdsTickets(tickets, 'hot', now);
eq('цех hot: чай отфильтрован', hot.find(v=>v.number===1)!.items.map(i=>i.name), ['Плов']);
eq('цех cold: только салат', kdsTickets(tickets,'cold',now).map(v=>v.number), [3]);

// ═══ Партия повара ═══
const batch = batchSummary(tickets, 'hot');
eq('Плов ×7 по двум тикетам', batch, [{name:'Плов', qty:7}]);
eq('готовый салат не в партии', batchSummary(tickets,'cold'), []);
eq('одиночные (×1) не показываются', batchSummary(tickets,'bar'), []);

// ═══ Скорость кухни ═══
eq('средняя 12 мин', kitchenSpeed([
  {sentAt:at(0), cookedAt:at(10)}, {sentAt:at(0), cookedAt:at(14)}]), 12);
eq('пусто → null', kitchenSpeed([]), null);

// ═══ Recall-стек ═══
let st = pushRecall([], 'i1', now);
st = pushRecall(st, 'i2', now);
eq('последний сверху', st[0].itemId, 'i2');
for (let k=0;k<9;k++) st = pushRecall(st, `x${k}`, now);
eq('стек ограничен 5', st.length, 5);

// ═══ ЖИВОЙ РЕНДЕР ═══
const h = clean(renderToString(<KdsScreen tickets={tickets}
  stations={[{id:'hot',name:'Горячий'},{id:'cold',name:'Холодный'},{id:'bar',name:'Бар'}]}
  now={now}
  onStart={()=>{}} onCooked={()=>{}} onTicketDone={()=>{}} onRecall={()=>{}}
  lastCooked={{itemId:'i4', name:'Салат'}} />));
eq('3 цеха + Все', (h.match(/class="st /g)||[]).length, 4);
eq('партия «Плов ×7» на экране', h.includes('Плов ×7'), true);
eq('тикет late подсвечен', h.includes('ticket-late'), true);
eq('таймер 25 мин', h.includes('25 мин'), true);
eq('модификатор «без лука» виден повару', h.includes('без лука'), true);
eq('кнопка Начать у SENT', h.includes('Начать'), true);
eq('кнопка Готово у COOKING', h.includes('Готово'), true);
eq('готовый заказ: «Собрано — уведомить»', h.includes('Собрано'), true);
eq('recall последнего блюда', h.includes('Вернуть «Салат»'), true);
eq('стол 5 в шапке тикета', h.includes('Стол 5'), true);
eq('канал «С собой» подписан', h.includes('С собой'), true);

// ═══ СООТВЕТСТВИЕ МАКЕТУ (вторая волна) ═══
eq('словарь KDS двуязычен', Object.keys(KT).filter(k => !(KT as any)[k].ru || !(KT as any)[k].kk), []);
eq('«Начать» из макета', kt('start','ru'), 'Начать');
eq('«Готовится» из макета', kt('cooking','ru'), 'Готовится');
eq('kk: Дайын', kt('ready','kk'), 'Дайын');
eq('статус SENT → Новый', itemStatusLabel('SENT','ru'), 'Новый');
eq('статус COOKING → Готовится', itemStatusLabel('COOKING','ru'), 'Готовится');

const hFull = clean(renderToString(<KdsScreen tickets={tickets}
  stations={[{id:'hot',name:'Горячий'},{id:'cold',name:'Холодный'},{id:'bar',name:'Бар'},{id:'tandyr',name:'Тандыр'}]}
  now={now} placeName="Дастархан Абая" avgMinutes={9}
  onStart={()=>{}} onCooked={()=>{}} onTicketDone={()=>{}} onRecall={()=>{}} />));
eq('шапка: название точки', hFull.includes('Кухня · Дастархан Абая'), true);
eq('шапка: в работе', hFull.includes('в работе'), true);
eq('шапка: среднее время', hFull.includes('среднее время') && hFull.includes('9 мин'), true);
eq('4 цеха + Все', (hFull.match(/class="st /g)||[]).length, 5);
eq('«Собрано — уведомить»', hFull.includes('Собрано — уведомить'), true);

// пустое состояние цеха — из макета
const hEmpty = clean(renderToString(<KdsScreen tickets={[]}
  stations={[{id:'bar',name:'Бар'}]} now={now}
  onStart={()=>{}} onCooked={()=>{}} onTicketDone={()=>{}} onRecall={()=>{}} onShowAll={()=>{}} />));
eq('пусто: заголовок из макета', hEmpty.includes('В этом цехе тикетов нет'), true);
eq('пусто: подсказка про звук', hEmpty.includes('со звуком'), true);
eq('пусто: кнопка «Показать все цеха»', hEmpty.includes('Показать все цеха'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

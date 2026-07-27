import React from 'react';
import { renderToString } from 'react-dom/server';
import { appReduce, screenAfterLogin, tapBudget, deriveTableState, tableColor,
  HallScreen, App } from './app.tsx';
import type { AppState, TableVm } from './app.tsx';
import { PinScreen, OrderScreen, PaymentScreen } from './screens.tsx';
import { reduceOrder } from './order.ts';
import type { OrderState } from './order.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};

// ═══ Машина экранов ═══
eq('кафе стартует с зала', screenAfterLogin('CAFE'), 'HALL');
eq('фастфуд сразу заказ', screenAfterLogin('FASTFOOD'), 'ORDER');
eq('магазин сразу заказ', screenAfterLogin('SHOP'), 'ORDER');
eq('бильярд — зал (столы!)', screenAfterLogin('BILLIARD'), 'HALL');

let s: AppState = { screen:'PIN', vertical:'CAFE', order:null, orderSeq:1 };
s = appReduce(s, { type:'login', user:{id:'u1',name:'Айгерим'} });
eq('после PIN — зал', s.screen, 'HALL');
s = appReduce(s, { type:'openOrderAtTable', tableId:'t5' });
eq('стол открыл заказ DINE_IN', [s.screen, s.order?.mode, s.order?.tableId], ['ORDER','DINE_IN','t5']);
// пустой заказ в оплату не уходит
s = appReduce(s, { type:'goPay' });
eq('пустой заказ не в оплату', s.screen, 'ORDER');
s = appReduce(s, { type:'orderEvent', ev:{ type:'order.item.added', orderId:s.order!.orderId,
  itemId:'i1', productId:'plov', name:'Плов', guestNo:0, qty:1, unitPrice:250000, modifiers:[] } });
s = appReduce(s, { type:'goPay' });
eq('с позицией — в оплату', s.screen, 'PAYMENT');
s = appReduce(s, { type:'paid' });
eq('кафе после оплаты → зал, заказ сброшен', [s.screen, s.order], ['HALL', null]);
eq('номер заказа растёт', s.orderSeq, 2);
// фастфуд: после оплаты сразу заказ
let f: AppState = { screen:'PIN', vertical:'FASTFOOD', order:null, orderSeq:1 };
f = appReduce(f, { type:'login', user:{id:'u',name:'x'} });
eq('фастфуд после PIN сразу заказ', f.screen, 'ORDER');

// бюджет касаний — вычислен из машины
eq('фастфуд: 4 касания', tapBudget('FASTFOOD'), 4);
eq('кафе: 5 касаний', tapBudget('CAFE'), 5);
eq('обещание ≤6 выполнено везде', Math.max(tapBudget('CAFE'),tapBudget('SHOP'),tapBudget('BILLIARD')) <= 6, true);

// ═══ Состояние столов (правило цветов Poster) ═══
const now = new Date('2026-07-19T14:00:00');
eq('нет заказа → free', deriveTableState('t1', [], now), { state:'free' });
const d = deriveTableState('t2', [{tableId:'t2', status:'OPEN', precheckAt:null, subtotal:500000, openedAt:'2026-07-19T13:35:00'}], now);
eq('открыт → busy, сумма, 25 мин', [d.state, d.total, d.minutes], ['busy', 500000, 25]);
eq('пречек → precheck', deriveTableState('t3',
  [{tableId:'t3', status:'OPEN', precheckAt:'x', subtotal:1, openedAt:'2026-07-19T13:00:00'}], now).state, 'precheck');
eq('закрытый не красит стол', deriveTableState('t4',
  [{tableId:'t4', status:'CLOSED', precheckAt:null, subtotal:1, openedAt:'2026-07-19T13:00:00'}], now).state, 'free');
eq('цвета трёх состояний различны', new Set([tableColor('free'),tableColor('busy'),tableColor('precheck')]).size, 3);

// ═══ ЖИВОЙ РЕНДЕР всех экранов (renderToString) ═══
const html1 = renderToString(<PinScreen onSubmit={async()=>true} />);
eq('PIN рендерится: numpad 12 кнопок', (html1.match(/numpad-key/g)||[]).length, 12);

const tables: TableVm[] = [
  { id:'t1', name:'1', x:0, y:0, shape:'rect', seats:4, state:'free' },
  { id:'t2', name:'2', x:120, y:0, shape:'round', seats:2, state:'busy', total:500000, minutes:25 },
];
const html2 = renderToString(<HallScreen tables={tables} onTable={()=>{}} onQuickOrder={()=>{}} />);
eq('зал: 2 стола отрисованы', (html2.match(/class="table /g)||[]).length, 2);
eq('занятый стол показывает сумму', html2.includes('5 000'), true);
eq('легенда трёх состояний', ['lg-free','lg-busy','lg-precheck'].every(c=>html2.includes(c)), true);

let ord: OrderState | null = null;
ord = reduceOrder(ord, { type:'order.opened', orderId:'o1', number:7, mode:'DINE_IN', tableId:'t1' });
ord = reduceOrder(ord, { type:'order.item.added', orderId:'o1', itemId:'i1', productId:'plov',
  name:'Плов', guestNo:1, qty:2, unitPrice:250000, modifiers:[] });
const clean = (h:string)=>h.replace(/<!-- -->/g,'');
const html3raw = renderToString(<OrderScreen order={ord}
  catalog={[{productId:'plov',name:'Плов',price:250000,categoryId:'food'},
            {productId:'fish',name:'Рыба',price:1,categoryId:'food',stop:{remaining:null}}]}
  categories={[{id:'food',name:'Горячее'}]}
  online={false} unsyncedCount={3}
  onAdd={()=>{}} onPay={()=>{}} onItemTap={()=>{}} />);
const html3 = clean(html3raw);
eq('заказ: позиция в чеке ×2', html3.includes('×2'), true);
eq('итог 5 000 ₸ на экране', html3.includes('5 000'), true);
eq('офлайн-индикатор с очередью', html3.includes('Офлайн') && html3.includes('3'), true);
eq('стоп-плитка задизейблена', html3.includes('disabled'), true);
eq('бейдж СТОП отрисован', html3.includes('СТОП'), true);

const html4 = renderToString(<PaymentScreen due={670000}
  methods={[{id:'m1',name:'Наличные',kind:'CASH'},{id:'m2',name:'Kaspi',kind:'CARD'}]}
  onConfirm={()=>{}} onBack={()=>{}} />);
eq('оплата: сумма к оплате', html4.includes('6 700'), true);
eq('умные купюры: «Без сдачи» есть', html4.includes('Без сдачи'), true);
eq('numpad оплаты отрисован', (html4.match(/numpad-key/g)||[]).length, 12);

// корневой App стартует с PIN
const html5 = renderToString(<App vertical="CAFE" catalog={[]} categories={[]} tables={[]}
  methods={[]} onLogin={async()=>null} onAppend={()=>{}} />);
eq('App стартует с PIN-экрана', html5.includes('pin-screen'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

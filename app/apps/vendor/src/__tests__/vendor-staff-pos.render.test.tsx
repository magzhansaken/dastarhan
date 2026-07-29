import React from 'react';
import { renderToString } from 'react-dom/server';
import { OrderScreen, PaymentScreen, fiscalBadge } from '../../../pos/src/ui/screens/PosScreens.tsx';
import { StaffList, StaffCard, RoleEditor, lastLoginLabel } from '../../../backoffice/src/staff/StaffScreens.tsx';
import { VendorPulse, ClientHealth } from '../VendorScreens.tsx';
import { ROLE_PRESETS } from '../../../../packages/shared/src/permissions.ts';
import { reduceOrder } from '../../../../packages/shared/src/order/orderReducer.ts';
import type { OrderState } from '../../../../packages/shared/src/order/orderReducer.ts';
import type { AccountMetric, AccountTelemetry } from '../../../../packages/shared/src/platform/vendor.metrics.ts';
import type { TipRecord } from '../../../../packages/shared/src/staff/tips.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const D=(d:number,h=12)=>new Date(2026,6,d,h);

console.log('── ФИСКАЛЬНЫЙ БЕЙДЖ ──');
// Контракт живого компонента: состояния 'ok'|'queued'|'error'|'off', в ответе cls
eq('онлайн', fiscalBadge('ok'), {text:'Webkassa · чеки уходят', cls:'fiscal'});
eq('очередь', fiscalBadge('queued', 3), {text:'Webkassa · 3 в очереди', cls:'fiscal fiscal-off'});
eq('ошибка', fiscalBadge('error').cls, 'fiscal fiscal-err');
eq('без фискализации', fiscalBadge('off').cls, 'fiscal fiscal-off');

console.log('── КАССА: обновлённые экраны ──');
let ord: OrderState|null = null;
ord = reduceOrder(ord, {type:'order.opened', orderId:'o1', number:1042, mode:'DINE_IN', tableId:'t4'});
ord = reduceOrder(ord, {type:'order.item.added', orderId:'o1', itemId:'i1', productId:'besh',
  name:'Бешбармак', guestNo:1, qty:2, unitPrice:490000, modifiers:[]});
const h1 = clean(renderToString(<OrderScreen order={ord!}
  catalog={[{productId:'besh',name:'Бешбармак',price:490000,categoryId:'food'}]}
  categories={[{id:'food',name:'Горячее'}]}
  online={true} unsyncedCount={0}
  fiscal="ok" lang="ru" onLang={()=>{}} cashierName="Айгерим"
  onAdd={()=>{}} onPay={()=>{}} onItemTap={()=>{}} />));
eq('статус Webkassa в шапке', h1.includes('Webkassa · чеки уходят'), true);
eq('имя кассира', h1.includes('Айгерим'), true);
eq('переключатель Рус/Қаз', h1.includes('Рус') && h1.includes('Қаз'), true);

// Экран оплаты показывает компактную разбивку (подытог + скидка),
// список позиций живёт на экране заказа — это осознанный макет.
const h2 = clean(renderToString(<PaymentScreen due={1250000}
  methods={[{id:'m1',name:'Наличные',kind:'CASH'},{id:'m2',name:'Kaspi',kind:'CARD'}]}
  orderNumber={1042} tableName="4" cashierName="Айгерим"
  subtotal={1315800} discountAmount={65800}
  fiscal="ok" lang="ru" onLang={()=>{}}
  onSplit={()=>{}} onPrintCopy={()=>{}}
  onConfirm={()=>{}} onBack={()=>{}} />));
eq('контекст: Стол 4 · №1042', h2.includes('Стол 4') && h2.includes('1042'), true);
eq('подытог 13 158 ₸', h2.includes('13 158'), true);
eq('скидка строкой', h2.includes('658'), true);
eq('к оплате 12 500 ₸', h2.includes('12 500'), true);
eq('кнопка «Разделить»', h2.includes('Разделить'), true);
eq('кнопка «Копия чека»', h2.includes('Копия чека'), true);
// кнопка деления появляется только когда обработчик передан (право есть)
const h2b = clean(renderToString(<PaymentScreen due={1000} methods={[{id:'m',name:'Наличные',kind:'CASH'}]}
  onConfirm={()=>{}} onBack={()=>{}} />));
eq('без права — «Разделить» скрыто', h2b.includes('Разделить'), false);

console.log('── СОТРУДНИКИ И РОЛИ ──');
eq('вход только что', lastLoginLabel(new Date(2026,6,19,13,59), D(19,14)), 'только что');
eq('4 минуты назад', lastLoginLabel(new Date(2026,6,19,13,56), D(19,14)), '4 мин назад');
eq('ни разу', lastLoginLabel(null, D(19)), 'ни разу');
eq('3 дня назад', lastLoginLabel(new Date(2026,6,16,14), D(19,14)), '3 дн назад');

const h3 = clean(renderToString(<StaffList now={D(19,14)}
  rows={[{userId:'u1', name:'Айгерим Нурлановна', phone:'+7 707 441 09 62', roleName:'Кассир',
    points:[{id:'p1',name:'Абая 10',roleName:'Кассир'},{id:'p2',name:'Достык 88',roleName:'Менеджер'}],
    active:true, lastLoginAt:new Date(2026,6,19,13,56)}]}
  onOpen={()=>{}} onAdd={()=>{}} />));
eq('список: имя и телефон', h3.includes('Айгерим') && h3.includes('707'), true);
eq('доступ по двум точкам', h3.includes('Абая 10 — Кассир') && h3.includes('Достык 88 — Менеджер'), true);
eq('подсказка про кассира', h3.includes('Отчёты и себестоимость'), true);

const tips: TipRecord[] = [
  {id:'1', employeeId:'u1', method:'qr_direct', amount:4200000, at:D(5), locationId:'l'},
  {id:'2', employeeId:'u1', method:'qr_direct', amount:2220000, at:D(9), locationId:'l'},
];
const h4 = clean(renderToString(<StaffCard
  staff={{userId:'u1', name:'Айгерим Нурлановна', phone:'+7 707 441 09 62', roleName:'Кассир',
    pin:'1234', login:'aigerim', points:[{id:'p1',name:'Абая 10',roleName:'Кассир'}],
    pay:{kind:'percent', value:3}, accruedThisMonth:23052000,
    tipSlug:'aigerim', tipMethod:'qr_direct', active:true, joinedAt:new Date(2025,2,14)}}
  tips={tips} period={{from:D(1), to:D(31)}}
  actions={[{at:D(19,13), text:'Закрыла смену'},{at:D(19,12), text:'Удалила позицию (PIN менеджера)'}]}
  onBlock={()=>{}} onCopyTipLink={()=>{}} />));
eq('ссылка чаевых', h4.includes('dstrh.kz/tip/aigerim'), true);
eq('сумма чаевых 64 200 ₸', h4.includes('64 200'), true);
eq('честность: не берём процент', h4.includes('не попадают') || h4.includes('напрямую'), true);
eq('процент с чеков 3%', h4.includes('3%'), true);
eq('начислено 230 520 ₸', h4.includes('230 520'), true);
eq('журнал действий', h4.includes('Закрыла смену'), true);
eq('последствия блокировки', h4.includes('останутся в истории'), true);
eq('подсказка про две точки', h4.includes('На одной точке менеджер'), true);

const h5 = clean(renderToString(<RoleEditor roleName="Кассир"
  permissions={ROLE_PRESETS.CASHIER.permissions} presetKey="CASHIER"
  onPreset={()=>{}} onChange={()=>{}} onSave={()=>{}} dirty={true} />));
eq('6 групп прав', (h5.match(/class="perm-group"/g)||[]).length, 6);
eq('4 состояния в строке', h5.includes('Разрешено') && h5.includes('Своим PIN')
   && h5.includes('PIN старшего') && h5.includes('Запрещено'), true);
eq('пресеты ролей', h5.includes('Владелец') && h5.includes('Курьер'), true);
eq('своя роль', h5.includes('Сделать свою роль'), true);
eq('пояснение разницы состояний', h5.includes('без присмотра'), true);

console.log('── АДМИНКА ВЕНДОРА ──');
const A=(o:Partial<AccountMetric>):AccountMetric=>({accountId:'a',name:'X',status:'ACTIVE',
  mrr:1800000, startedAt:D(3), source:'self', firstReceiptAt:D(3), ...o});
const h6 = clean(renderToString(<VendorPulse
  accounts={[A({accountId:'1'}), A({accountId:'2', source:'dealer', mrr:1200000}),
             A({accountId:'3', status:'TRIAL', firstReceiptAt:null})]}
  period={{from:D(1), to:D(31)}} churnedThisPeriod={2} accountsAtStart={80}
  mrrPrevMonth={2800000} />));
eq('MRR отрисован', h6.includes('30 000'), true);
eq('рост в процентах', h6.includes('%'), true);
eq('разрез сами/дилеры', h6.includes('сами') && h6.includes('через дилеров'), true);
eq('метрика активации', h6.includes('до первого чека'), true);
eq('отток', h6.includes('Отток'), true);

const T=(o:Partial<AccountTelemetry>):AccountTelemetry=>({accountId:'t',name:'Кафе',mrr:1800000,
  lastTerminalSeenAt:new Date(2026,6,19,13), receiptsLast7d:100,
  revenueThisMonth:10_000_000, revenuePrevMonth:10_000_000, lastContactAt:D(1), status:'ACTIVE',...o});
const h7 = clean(renderToString(<ClientHealth now={D(19,14)} totalMrr={20_000_000}
  telemetry={[
    T({accountId:'1', name:'Дастархан', mrr:1800000, lastTerminalSeenAt:new Date(2026,6,17)}),
    T({accountId:'2', name:'Донер Хан', mrr:1200000, receiptsLast7d:0}),
    T({accountId:'3', name:'Здоровое', mrr:5000000}),
  ]}
  onCall={()=>{}} onExport={()=>{}} />));
eq('заголовок «кто уйдёт»', h7.includes('Кто уйдёт'), true);
eq('MRR под риском 30 000', h7.includes('30 000'), true);
eq('доля от MRR', h7.includes('% от всего MRR'), true);
eq('обзвон на сегодня 2', h7.includes('Обзвон на сегодня'), true);
eq('критичный первым', h7.indexOf('Дастархан') < h7.indexOf('Донер Хан'), true);
eq('здоровый не в списке', h7.includes('Здоровое'), false);
eq('кнопка Позвонить', h7.includes('Позвонить'), true);
eq('выгрузка списка', h7.includes('Выгрузить список'), true);

// пустое состояние
const h8 = clean(renderToString(<ClientHealth now={D(19,14)} totalMrr={1000}
  telemetry={[T({})]} onCall={()=>{}} onExport={()=>{}} />));
eq('всё хорошо — «звонить некому»', h8.includes('звонить сегодня некому'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

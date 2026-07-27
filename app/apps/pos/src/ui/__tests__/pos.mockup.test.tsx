// Тесты соответствия экранов кассы макетам Claude Design
import React from 'react';
import { renderToString } from 'react-dom/server';
import { OrderScreen, PaymentScreen, PinScreen, LangToggle, fiscalBadge, T, t } from './screens.tsx';
import { reduceOrder } from './order.ts';
import type { OrderState } from './order.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

// ═══ Словарь: каждый ключ имеет ru и kk ═══
const keys = Object.keys(T) as (keyof typeof T)[];
eq('словарь: 50+ ключей', keys.length >= 50, true);
eq('все ключи двуязычны', keys.filter(k => !T[k].ru || !T[k].kk), []);
eq('t() отдаёт русский', t('toPay','ru'), 'К оплате');
eq('t() отдаёт казахский', t('toPay','kk'), 'Төлемге');
eq('«Пробить чек» из макета', t('punch','ru'), 'Пробить чек');
eq('«В ящике сейчас» из макета', t('inDrawer','ru'), 'В ящике сейчас');
eq('«Заказ пустой» из макета', t('emptyT','ru'), 'Заказ пустой');

// ═══ Бейдж фискализации ═══
eq('фискал ок', fiscalBadge('ok',0,'ru').text, 'Webkassa · чеки уходят');
eq('фискал очередь', fiscalBadge('queued',3,'ru').text.includes('3 в очереди'), true);
eq('фискал ошибка — класс', fiscalBadge('error',0,'ru').cls, 'fiscal fiscal-err');

// ═══ Заказ: полный набор элементов макета ═══
let ord: OrderState|null = null;
ord = reduceOrder(ord, {type:'order.opened', orderId:'o1', number:42, mode:'DINE_IN', tableId:'t4'});
ord = reduceOrder(ord, {type:'order.item.added', orderId:'o1', itemId:'i1', productId:'besh',
  name:'Бешбармак с конины', guestNo:1, qty:2, unitPrice:490000, modifiers:[]});
ord = reduceOrder(ord, {type:'order.item.added', orderId:'o1', itemId:'i2', productId:'lag',
  name:'Лагман', guestNo:1, qty:1, unitPrice:180000, modifiers:[{optionId:'no', name:'Без лука', priceDelta:0}]});

const h = clean(renderToString(<OrderScreen order={ord!}
  catalog={[
    {productId:'besh',name:'Бешбармак с конины',price:490000,categoryId:'hot'},
    {productId:'plov',name:'Плов по-казахски',price:240000,categoryId:'hot'},
    {productId:'manty',name:'Манты',price:200000,categoryId:'hot',stop:{remaining:null}},
  ]}
  categories={[{id:'hot',name:'Горячее'},{id:'salad',name:'Салаты'},{id:'tandyr',name:'Тандыр'}]}
  online={false} unsyncedCount={3} fiscal="queued" onLang={()=>{}}
  cashierName="Айгерим" tableName="4" openedMinutes={12}
  loyaltyLabel="Айгерим, гость" discountAmount={65800}
  frequentIds={['besh','plov']}
  onAdd={()=>{}} onPay={()=>{}} onItemTap={()=>{}}
  onPrecheck={()=>{}} onToKitchen={()=>{}} onHall={()=>{}} onStopList={()=>{}} />));

eq('шапка: заказ, стол, минуты', h.includes('№42') && h.includes('Стол 4') && h.includes('12 мин'), true);
eq('офлайн с очередью', h.includes('Офлайн · 3 в очереди'), true);
eq('лояльность гостя', h.includes('Айгерим, гость'), true);
eq('кнопка «Карта зала»', h.includes('Карта зала'), true);
eq('кассир в шапке', h.includes('Айгерим · кассир'), true);
eq('бейдж Webkassa', h.includes('Webkassa'), true);
eq('переключатель Рус/Қаз в кассе', h.includes('Рус') && h.includes('Қаз'), true);
eq('поиск с подписью макета', h.includes('Поиск блюда или кода'), true);
eq('раздел «Часто»', h.includes('Часто'), true);
eq('кнопка «Стоп-лист»', h.includes('Стоп-лист'), true);
eq('кнопки Пречек и На кухню', h.includes('Пречек') && h.includes('На кухню'), true);
eq('скидка строкой', h.includes('Скидка') && h.includes('658'), true);
eq('позиции счётчиком', h.includes('2 позиции'), true);
eq('модификатор Без лука', h.includes('Без лука'), true);
eq('стоп-плитка с подписью Стоп', h.includes('Стоп'), true);

// пустой заказ → состояние из макета
let empty: OrderState|null = reduceOrder(null, {type:'order.opened', orderId:'o2', number:1, mode:'TAKEOUT'});
const he = clean(renderToString(<OrderScreen order={empty!} catalog={[]} categories={[]}
  online={true} unsyncedCount={0} onAdd={()=>{}} onPay={()=>{}} onItemTap={()=>{}} />));
eq('пустой заказ: заголовок', he.includes('Заказ пустой'), true);
eq('пустой заказ: подсказка', he.includes('Нажмите блюдо справа'), true);
eq('пустой каталог: своё состояние', he.includes('Ничего не найдено'), true);

// ═══ Оплата: все блоки макета ═══
const hp = clean(renderToString(<PaymentScreen due={1250000}
  orderNumber={42} tableName="4" cashierName="Айгерим"
  subtotal={1315800} discountAmount={65800} drawerCash={4800000} fiscal="ok"
  methods={[{id:'m1',name:'Наличные',kind:'CASH'},{id:'m2',name:'Kaspi QR',kind:'KASPI_QR'},
            {id:'m3',name:'Карта',kind:'CARD'},{id:'m4',name:'Смешанная',kind:'MIXED'}]}
  onConfirm={()=>{}} onBack={()=>{}} onSplit={()=>{}} onPrintCopy={()=>{}} />));

eq('шапка оплаты: номер и стол', hp.includes('№42') && hp.includes('Стол 4'), true);
eq('состав чека: Сумма', hp.includes('Сумма'), true);
eq('скидка в разбивке', hp.includes('−658'), true);
eq('К оплате 12 500', hp.includes('К оплате') && hp.includes('12 500'), true);
eq('4 способа оплаты', hp.includes('Наличные') && hp.includes('Kaspi QR') && hp.includes('Карта') && hp.includes('Смешанная'), true);
eq('подсказки способов', hp.includes('без сдачи и с купюр'), true);
eq('«Купюрами» над кнопками', hp.includes('Купюрами'), true);
eq('«Внесено наличными»', hp.includes('Внесено наличными'), true);
eq('«Не хватает» при нуле внесённых', hp.includes('Не хватает'), true);
eq('подсказка набора суммы', hp.includes('Нажмите купюру'), true);
eq('«В ящике сейчас» с суммой', hp.includes('В ящике сейчас') && hp.includes('48 000'), true);
eq('кнопки Разделить и Копия чека', hp.includes('Разделить') && hp.includes('Копия чека'), true);
eq('кнопка «Пробить чек»', hp.includes('Пробить чек'), true);

// экраны Kaspi и карты
const hk = clean(renderToString(<PaymentScreen due={1250000} kaspiState="waiting"
  methods={[{id:'m2',name:'Kaspi QR',kind:'KASPI_QR'}]}
  onConfirm={()=>{}} onBack={()=>{}} onManualPaid={()=>{}} />));
eq('Kaspi: «Ждём оплату»', hk.includes('Ждём оплату'), true);
eq('Kaspi: 5–10 секунд', hk.includes('5–10 секунд'), true);
eq('Kaspi: отметить вручную', hk.includes('Отметить оплату вручную'), true);

const hc = clean(renderToString(<PaymentScreen due={1250000}
  methods={[{id:'m3',name:'Карта',kind:'CARD'}]}
  onConfirm={()=>{}} onBack={()=>{}} onRetryTerminal={()=>{}} />));
eq('Карта: проведите на терминале', hc.includes('Проведите карту на терминале'), true);
eq('Карта: повторить отправку', hc.includes('Повторить отправку'), true);

// казахская версия
const hkk = clean(renderToString(<PaymentScreen due={1250000} lang="kk"
  methods={[{id:'m1',name:'Қолма-қол',kind:'CASH'}]}
  onConfirm={()=>{}} onBack={()=>{}} />));
eq('kk: Төлемге', hkk.includes('Төлемге'), true);
eq('kk: Қайтарым', hkk.includes('Қайтарым'), true);
eq('kk: Чекті өткізу', hkk.includes('Чекті өткізу'), true);

// PIN с подписью
const hpin = clean(renderToString(<PinScreen onSubmit={async()=>true} />));
eq('PIN: подпись «Введите PIN»', hpin.includes('Введите PIN'), true);
const hpinkk = clean(renderToString(<PinScreen onSubmit={async()=>true} lang="kk" />));
eq('PIN kk: «PIN енгізіңіз»', hpinkk.includes('PIN енгізіңіз'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

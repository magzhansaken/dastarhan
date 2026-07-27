import React from 'react';
import { renderToString } from 'react-dom/server';
import { itemName, guestMenu, cartAdd, cartTotal, buildTableOrder, GuestMenuPage, TAG_BADGES } from './guest.tsx';
import type { GuestMenuItem } from './guest.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

const items: GuestMenuItem[] = [
  { productId:'plov', name:'Плов', nameKk:'Палау', price:250000, categoryId:'food', tags:['hit'] },
  { productId:'lagman', name:'Лагман острый', nameKk:'Ащы лағман', price:220000, categoryId:'food', tags:['spicy'] },
  { productId:'salad', name:'Салат', price:150000, categoryId:'food', tags:['veg'] },
  { productId:'fish', name:'Рыба', price:300000, categoryId:'food', stopped:true },
  { productId:'tea', name:'Чай', nameKk:'Шай', price:80000, categoryId:'drink' },
];

// ═══ Язык ═══
eq('kk-имя при наличии', itemName(items[0],'kk'), 'Палау');
eq('фолбэк на ru без kk', itemName(items[2],'kk'), 'Салат');

// ═══ Фильтры ═══
eq('стоп скрыт от гостя', guestMenu(items,null,null,'').map(i=>i.productId).includes('fish'), false);
eq('всего видно 4', guestMenu(items,null,null,'').length, 4);
eq('категория drink', guestMenu(items,'drink',null,'').map(i=>i.productId), ['tea']);
eq('тег 🌶 spicy', guestMenu(items,null,'spicy','').map(i=>i.productId), ['lagman']);
eq('поиск по-русски', guestMenu(items,null,null,'лагман').map(i=>i.productId), ['lagman']);
eq('поиск ПО-КАЗАХСКИ находит', guestMenu(items,null,null,'палау').map(i=>i.productId), ['plov']);
eq('поиск шай', guestMenu(items,null,null,'шай').map(i=>i.productId), ['tea']);

// ═══ Корзина ═══
let cart = cartAdd([], items[0], 'kk');
cart = cartAdd(cart, items[0], 'kk');
cart = cartAdd(cart, items[4], 'ru');
eq('плов ×2 + чай', cart.map(l=>[l.name,l.qty]), [['Палау',2],['Чай',1]]);
eq('итог 5800', cartTotal(cart), 580000);

// ═══ Payload заказа ═══
const p = buildTableOrder('tok-t5', cart, 'без лука');
eq('токен стола в заказе', p.tableToken, 'tok-t5');
eq('источник qr_table', p.source, 'qr_table');
eq('позиции с qty', p.items, [{productId:'plov',qty:2},{productId:'tea',qty:1}]);
let threw=false; try { buildTableOrder('t',[]) } catch { threw=true }
eq('пустая корзина не отправляется', threw, true);

// ═══ ЖИВОЙ РЕНДЕР: русская версия ═══
const h = clean(renderToString(<GuestMenuPage
  shopName="Дастархан" tableName="5" tableToken="tok-t5"
  categories={[{id:'food',name:'Горячее',nameKk:'Ыстық'},{id:'drink',name:'Напитки',nameKk:'Сусындар'}]}
  items={items} selfOrderEnabled={true}
  onSubmitOrder={()=>{}} onCallWaiter={()=>{}} />));
eq('шапка: заведение и стол', h.includes('Дастархан') && h.includes('Стол') && h.includes('5'), true);
eq('переключатель Рус/Қаз', h.includes('Рус') && h.includes('Қаз'), true);
eq('кнопка «Позвать официанта»', h.includes('Позвать официанта'), true);
eq('стоп-блюдо не отрисовано', h.includes('Рыба'), false);
eq('бейдж 🌶 у лагмана', h.includes('🌶'), true);
eq('бейдж 🌿 у салата', h.includes('🌿'), true);
eq('фильтры тегов отрисованы', Object.values(TAG_BADGES).every(b=>h.includes(b)), true);
eq('цена плова 2 500 ₸', h.includes('2 500'), true);
eq('кнопка + для заказа', h.includes('g-add'), true);

// self-order выключен владельцем — кнопок + нет
const h2 = clean(renderToString(<GuestMenuPage
  shopName="x" tableName="1" tableToken="t"
  categories={[]} items={items} selfOrderEnabled={false}
  onSubmitOrder={()=>{}} onCallWaiter={()=>{}} />));
eq('без self-order кнопок + нет', h2.includes('g-add'), false);
eq('но официанта позвать можно', h2.includes('Позвать официанта'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

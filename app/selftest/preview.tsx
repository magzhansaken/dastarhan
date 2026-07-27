import React from 'react';
import { renderToString } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { PinScreen, OrderScreen, PaymentScreen } from './screens.tsx';
import { HallScreen } from './app.tsx';
import { KdsScreen } from './kds.tsx';
import { Dashboard, TechCardEditor, OnboardingWizard } from './boscreens.tsx';
import { SupplyScreen, InventoryScreen } from './stockscreens.tsx';
import { PnlScreen, AbcScreen } from './repscreens.tsx';
import { ReservationsScreen } from './resv.tsx';
import { GuestMenuPage } from './guest.tsx';
import { reduceOrder } from './order.ts';
import type { OrderState } from './order.ts';

const at=(h:number,m=0)=>new Date(2026,6,19,h,m);
const posCss = readFileSync('pos.css','utf8');
const boCss = readFileSync('bo.css','utf8');

const frame = (title:string, css:string, dark:boolean, sections:{name:string;html:string;height?:number}[]) => `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${css}
/* превью-обёртка */
body{overflow:auto!important;height:auto!important;background:${dark?'#0b0d12':'#eceef3'}}
.pv-section{margin:28px auto;max-width:1120px}
.pv-label{font:700 13px/1 -apple-system,Segoe UI,sans-serif;color:${dark?'#9aa3b2':'#6b7484'};
  text-transform:uppercase;letter-spacing:.08em;margin:0 12px 10px}
.pv-frame{border-radius:18px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.25);
  background:${dark?'var(--bg)':'var(--bg)'};position:relative}
</style></head><body>
<h1 style="font:800 26px -apple-system,Segoe UI,sans-serif;text-align:center;margin:26px;color:${dark?'#f2f4f8':'#1a1f2b'}">${title}</h1>
${sections.map(s=>`<div class="pv-section"><div class="pv-label">${s.name}</div>
<div class="pv-frame" style="height:${s.height??640}px">${s.html}</div></div>`).join('\n')}
</body></html>`;

// ═══ КАССА ═══
let ord: OrderState|null = null;
ord = reduceOrder(ord, {type:'order.opened', orderId:'o1', number:42, mode:'DINE_IN', tableId:'t1'});
ord = reduceOrder(ord, {type:'order.item.added', orderId:'o1', itemId:'i1', productId:'plov', name:'Плов', guestNo:1, qty:2, unitPrice:250000, modifiers:[]});
ord = reduceOrder(ord, {type:'order.item.added', orderId:'o1', itemId:'i2', productId:'capp', name:'Капучино', guestNo:1, qty:1, unitPrice:170000, modifiers:[{optionId:'oat', name:'Овсяное молоко', priceDelta:20000}]});

const cassaHtml = frame('Dastarhan POS — касса', posCss, true, [
  { name:'Вход по PIN', html: renderToString(<PinScreen onSubmit={async()=>true} />), height:560 },
  { name:'Зал (кафе/бильярд стартуют здесь)', html: renderToString(<HallScreen
      tables={[
        {id:'t1',name:'1',x:24,y:24,shape:'rect',seats:4,state:'free'},
        {id:'t2',name:'2',x:160,y:24,shape:'round',seats:2,state:'busy',total:500000,minutes:25},
        {id:'t3',name:'3',x:296,y:24,shape:'rect',seats:4,state:'precheck',total:1240000,minutes:73},
        {id:'t4',name:'4',x:24,y:160,shape:'rect',seats:6,state:'free'},
        {id:'t5',name:'5',x:160,y:160,shape:'round',seats:4,state:'busy',total:890000,minutes:12},
      ]} onTable={()=>{}} onQuickOrder={()=>{}} />), height:420 },
  { name:'Заказ (чек + каталог)', html: renderToString(<OrderScreen order={ord!}
      catalog={[
        {productId:'plov',name:'Плов',price:250000,categoryId:'food'},
        {productId:'besh',name:'Бешбармак',price:320000,categoryId:'food'},
        {productId:'lagm',name:'Лагман',price:220000,categoryId:'food',stop:{remaining:3}},
        {productId:'manty',name:'Манты (5 шт)',price:200000,categoryId:'food'},
        {productId:'fish',name:'Рыба на гриле',price:390000,categoryId:'food',stop:{remaining:null}},
        {productId:'capp',name:'Капучино',price:150000,categoryId:'drink'},
        {productId:'tea',name:'Чай тандырный',price:80000,categoryId:'drink'},
        {productId:'cola',name:'Кола 0.5',price:60000,categoryId:'drink'},
      ]}
      categories={[{id:'food',name:'Горячее'},{id:'drink',name:'Напитки'}]}
      online={false} unsyncedCount={3}
      onAdd={()=>{}} onPay={()=>{}} onItemTap={()=>{}} />), height:620 },
  { name:'Оплата (умные купюры, сдача крупно)', html: renderToString(<PaymentScreen due={690000}
      methods={[{id:'m1',name:'Наличные',kind:'CASH'},{id:'m2',name:'Kaspi терминал',kind:'CARD'},{id:'m3',name:'Kaspi QR',kind:'KASPI_QR'}]}
      onConfirm={()=>{}} onBack={()=>{}} />), height:720 },
  { name:'KDS — кухня (партия повара, эскалация)', html: renderToString(<KdsScreen
      tickets={[
        { orderId:'o1', number:41, mode:'TAKEOUT', items:[
          { itemId:'a', orderId:'o1', productId:'plov', name:'Плов', qty:3, modifiers:['без лука'], course:1, station:'hot', kitchenStatus:'COOKING', sentAt:at(13,52) }]},
        { orderId:'o2', number:42, mode:'DINE_IN', tableName:'5', items:[
          { itemId:'b', orderId:'o2', productId:'plov', name:'Плов', qty:2, modifiers:[], course:1, station:'hot', kitchenStatus:'SENT', sentAt:at(14,5) },
          { itemId:'c', orderId:'o2', productId:'manty', name:'Манты', qty:1, modifiers:[], comment:'аллергия на кинзу', course:1, station:'hot', kitchenStatus:'SENT', sentAt:at(14,5) }]},
        { orderId:'o3', number:43, mode:'DELIVERY', items:[
          { itemId:'d', orderId:'o3', productId:'besh', name:'Бешбармак', qty:1, modifiers:[], course:1, station:'hot', kitchenStatus:'COOKED', sentAt:at(13,58) }]},
      ]}
      stations={[{id:'hot',name:'Горячий'},{id:'cold',name:'Холодный'},{id:'bar',name:'Бар'}]}
      now={at(14,10)}
      onStart={()=>{}} onCooked={()=>{}} onTicketDone={()=>{}} onRecall={()=>{}}
      lastCooked={{itemId:'d', name:'Бешбармак'}} />), height:520 },
]);
writeFileSync('/mnt/user-data/outputs/превью_КАССА.html', cassaHtml);

// ═══ БЭК-ОФИС ═══
const boHtml = frame('Dastarhan — бэк-офис владельца', boCss, false, [
  { name:'Дашборд «Как идут дела»', html: renderToString(<Dashboard data={{
      todayRevenue:15_430_000, yesterdaySameTime:12_100_000, checks:47, avgCheck:328_000,
      alerts:[{severity:'MEDIUM', text:'Фудкост «Плов» вырос на 6пп — проверьте цену риса'}],
      unsyncedTerminals:0 }} />), height:340 },
  { name:'Техкарта с живым фудкостом', html: renderToString(<TechCardEditor
      productName="Плов" salePrice={250000}
      ctx={{ ingredientCost:new Map([['rice',60],['zirvak',150]]), techCards:new Map(), productType:new Map() }}
      initial={[
        {componentId:'rice', name:'Рис', brutto:120, netto:110},
        {componentId:'zirvak', name:'Зирвак (ПФ)', brutto:250, netto:250}]}
      outputQty={400} componentSearch={()=>[]} onSave={()=>{}} />), height:560 },
  { name:'Приход с ценовым контролем', html: renderToString(<SupplyScreen
      suppliers={[{id:'s1',name:'ИП Ерболат (овощи)'}]}
      initialRows={[
        {productId:'rice', name:'Рис', unit:'кг', qty:20, priceTenge:600, lastPriceTenge:600},
        {productId:'oil', name:'Масло подсолнечное', unit:'л', qty:5, priceTenge:1800, lastPriceTenge:1200}]}
      searchProducts={()=>[]} onAiPhoto={()=>{}} onSaveDraft={()=>{}} onPost={()=>{}} />), height:520 },
  { name:'Инвентаризация без остановки продаж', html: renderToString(<InventoryScreen
      startedAt="19.07 14:00" blindMode={false}
      rows={[
        {productId:'cola', name:'Кола', unit:'шт', bookAtStart:100, movedAfterStart:-20, counted:75, avgCostTenge:150},
        {productId:'chips', name:'Чипсы', unit:'шт', bookAtStart:50, movedAfterStart:0, counted:53, avgCostTenge:200},
        {productId:'tea', name:'Чай', unit:'шт', bookAtStart:10, movedAfterStart:0, counted:null, avgCostTenge:100}]}
      onCount={()=>{}} onToggleBlind={()=>{}} onPost={()=>{}} canPost={true} />), height:520 },
  { name:'P&L с налогом КЗ (монополия)', html: renderToString(<PnlScreen
      cur={{revenue:10_000_000, cogs:3_000_000, opex:4_000_000, tax:300_000, netProfit:2_700_000}}
      prev={{revenue:8_000_000, cogs:2_800_000, opex:3_900_000, tax:240_000, netProfit:1_060_000}} />), height:480 },
  { name:'ABC «Что делать»', html: renderToString(<AbcScreen rows={[
      {productId:'plov', name:'Плов', revenueClass:'A', marginClass:'A'},
      {productId:'besh', name:'Бешбармак', revenueClass:'A', marginClass:'C'},
      {productId:'tea', name:'Чай тандырный', revenueClass:'C', marginClass:'A'},
      {productId:'cola', name:'Кола', revenueClass:'C', marginClass:'C'}]} />), height:420 },
  { name:'Шахматка броней (модель r_keeper)', html: renderToString(<ReservationsScreen
      day={at(0)} now={at(19,30)}
      tables={[{id:'t1',name:'1',seats:4},{id:'t2',name:'2',seats:2},{id:'t3',name:'VIP',seats:8}]}
      reservations={[
        {id:'r1', tableId:'t1', startAt:at(19), endAt:at(21), guestPhone:'+7707…', guestName:'Асель', persons:4, status:'BOOKED'},
        {id:'r2', tableId:'t3', startAt:at(20), endAt:at(23), guestPhone:'+7701…', guestName:'Т.Даулет', persons:8, status:'BOOKED', depositAmount:1000000}]}
      onSeat={()=>{}} onCancel={()=>{}} onNew={()=>{}} />), height:520 },
  { name:'Онбординг «15 минут до чека»', html: renderToString(<OnboardingWizard
      vertical="CAFE" state={{org:true, menu:true}} onGo={()=>{}} />), height:480 },
]);
writeFileSync('/mnt/user-data/outputs/превью_БЭКОФИС.html', boHtml);

// ═══ ГОСТЬ ═══
const guestHtml = frame('Dastarhan — QR-меню гостя (телефон)', boCss, false, [
  { name:'Меню со стола №5 (ru/kk, позвать официанта)', html: renderToString(<GuestMenuPage
      shopName="Дастархан" tableName="5" tableToken="tok"
      categories={[{id:'food',name:'Горячее',nameKk:'Ыстық'},{id:'drink',name:'Напитки',nameKk:'Сусындар'}]}
      items={[
        {productId:'plov', name:'Плов', nameKk:'Палау', description:'Рис, говядина, морковь — по-домашнему', price:250000, categoryId:'food', tags:['hit']},
        {productId:'lagm', name:'Лагман острый', nameKk:'Ащы лағман', description:'Домашняя лапша, огненный соус', price:220000, categoryId:'food', tags:['spicy']},
        {productId:'salad', name:'Салат овощной', description:'Свежие овощи, масло', price:150000, categoryId:'food', tags:['veg','halal']},
        {productId:'tea', name:'Чай тандырный', nameKk:'Тандыр шай', price:80000, categoryId:'drink'}]}
      selfOrderEnabled={true} onSubmitOrder={()=>{}} onCallWaiter={()=>{}} />), height:820 },
]);
writeFileSync('/mnt/user-data/outputs/превью_ГОСТЬ.html', guestHtml);

console.log('превью собраны: касса', cassaHtml.length, '| бэкофис', boHtml.length, '| гость', guestHtml.length);

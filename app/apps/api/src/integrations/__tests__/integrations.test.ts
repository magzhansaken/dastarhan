import { botStep, START_STATE, cartTotal } from '../telegram.bot.ts';
import type { ChatState, MenuData } from '../telegram.bot.ts';
import { kaspiQrCreate, kaspiQrAdvance, kaspiQrPollDelay, ReKassaDriver,
  mapWoltOrder, mapMenuToWolt, stopListToWolt } from '../kz.integrations.ts';
import type { FiscalRequest } from '../../payments/payments.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,120)} want ${JSON.stringify(w).slice(0,120)}`))};

// ═══ Telegram: полный путь заказа ═══
const menu: MenuData = {
  categories: [{id:'food',name:'Горячее'},{id:'drink',name:'Напитки'}],
  items: [
    {productId:'plov',name:'Плов',price:250000,categoryId:'food'},
    {productId:'tea',name:'Чай',price:80000,categoryId:'drink'},
    {productId:'fish',name:'Рыба',price:300000,categoryId:'food',stopped:true},
  ],
};
let st: ChatState = START_STATE;
let r = botStep(st,'/start',menu); st=r.state;
eq('старт: категории кнопками', r.reply.keyboard![0].map(b=>b.label), ['Горячее','Напитки']);
r = botStep(st,'cat:food',menu); st=r.state;
eq('стоп-позиции скрыты из меню', r.reply.keyboard!.flat().some(b=>b.label.includes('Рыба')), false);
r = botStep(st,'add:plov',menu); st=r.state;
r = botStep(st,'add:plov',menu); st=r.state;
eq('плов ×2 в корзине', st.cart[0].qty, 2);
r = botStep(st,'add:fish',menu); st=r.state;
eq('стоп-позицию не добавить', st.cart.length, 1);
eq('вежливый отказ', r.reply.text.includes('закончилось'), true);
r = botStep(st,'cart',menu); st=r.state;
eq('корзина: итог 5000тг', r.reply.text.includes('5 000 ₸'), true);
r = botStep(st,'checkout',menu); st=r.state;
eq('запрошен телефон', st.step, 'PHONE');
r = botStep(st,'абракадабра',menu); st=r.state;
eq('кривой телефон переспрошен', st.step, 'PHONE');
r = botStep(st,'8 707 123 45 67',menu); st=r.state;
eq('телефон нормализован', st.phone, '+77071234567');
eq('выдана ссылка оплаты', r.reply.payLink, 'PENDING_KASPI_LINK');
r = botStep(st,'paid',menu); st=r.state;
eq('после оплаты — DONE', st.step, 'DONE');
// пустая корзина не оформляется
let e = botStep({...START_STATE, step:'CART'},'checkout',menu);
eq('пустую корзину не оформить', e.reply.text.includes('пуста'), true);

// ═══ Kaspi QR ═══
let q = kaspiQrCreate('p1', 500000, 0);
eq('создан', q.status, 'CREATED');
q = kaspiQrAdvance(q, {type:'scanned'});
eq('отсканирован', q.status, 'SCANNED');
q = kaspiQrAdvance(q, {type:'processed'});
eq('оплачен', q.status, 'PROCESSED');
eq('терминальный статус не меняется', kaspiQrAdvance(q,{type:'error'}).status, 'PROCESSED');
let q2 = kaspiQrCreate('p2', 100, 0, 5*60000);
q2 = kaspiQrAdvance(q2, {type:'tick', now: 6*60000});
eq('TTL истёк → EXPIRED', q2.status, 'EXPIRED');
eq('поллинг: сначала часто', kaspiQrPollDelay(10000), 2000);
eq('поллинг: потом реже', kaspiQrPollDelay(60000), 5000);

// ═══ re:Kassa: формат чека ═══
let captured: any = null;
const fakeFetch = (async (url: string, init: any) => {
  captured = { url, body: JSON.parse(init.body) };
  return { ok: true, status: 200, json: async () => ({ id: 'TKT-42', ticketUrl: 'https://ofd/42' }) };
}) as any;
const rk = new ReKassaDriver({ baseUrl:'https://api.rekassa.kz', cashboxNumber:'12345', token:'T' }, fakeFetch);
const req: FiscalRequest = {
  op:'SELL', total:361000,
  items:[{name:'Плов', qty:1, price:250000, vatRate:16},{name:'Чай', qty:1, price:111000, vatRate:0}],
  payments:[{kind:'CASH', amount:361000}],
};
const res = await rk.send(req);
eq('успех + номер чека', [res.success, res.fiscalNumber], [true,'TKT-42']);
eq('операция SELL', captured.body.operation, 'OPERATION_SELL');
eq('bills/coins: 2500тг', captured.body.items[0].commodity.price, {bills:2500, coins:0});
eq('quantity ×1000', captured.body.items[0].commodity.quantity, 1000);
// НДС в том числе: 250000×16/116 = 34483
eq('НДС «в том числе»', captured.body.items[0].commodity.taxes[0].sum, {bills:344, coins:83});
eq('без НДС — пустые taxes', captured.body.items[1].commodity.taxes, []);
eq('оплата наличными', captured.body.payments[0].type, 'PAYMENT_CASH');

// ═══ Wolt ═══
const draft = mapWoltOrder({
  id:'wolt-777', venue:{id:'v1'},
  items:[{name:'Плов', count:2, base_price:250000, pos_id:'plov'},
         {name:'Секретный соус', count:1, base_price:50000}],
  consumer_phone_number:'+77071234567',
  delivery:{location:{formatted_address:'Абая 10, кв 5'}},
  price:{amount:550000, currency:'KZT'},
});
eq('externalId и источник', [draft.source, draft.externalId], ['wolt','wolt-777']);
eq('pos_id → наш productId', draft.lines[0].productId, 'plov');
eq('без pos_id → null (в ИИ-матчинг)', draft.lines[1].productId, null);
eq('итог совпал', draft.total, 550000);
eq('меню в Wolt с pos_id', mapMenuToWolt([{productId:'plov',name:'Плов',price:250000}])[0].pos_id, 'plov');
eq('стоп-лист гасит позиции', stopListToWolt(['plov']), [{pos_id:'plov', enabled:false}]);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

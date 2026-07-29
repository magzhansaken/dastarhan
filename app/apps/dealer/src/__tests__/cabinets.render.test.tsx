import React from 'react';
import { renderToString } from 'react-dom/server';
import { BillingScreen } from '../../../billing/src/BillingScreens.tsx';
import { DealerCabinet } from '../DealerScreens.tsx';
import type { Invoice, LocationBilling } from '../../../../packages/shared/src/platform/billing.logic.ts';
import type { DealerClient, MonthlyAccrual, DemoStand } from '../../../../packages/shared/src/platform/dealer.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const D=(d:number,h=12)=>new Date(2026,6,d,h);

const locs: LocationBilling[] = [
  {id:'l1', name:'Абая 10', address:'Алматы', terminals:1},
  {id:'l2', name:'Достык 88', address:'Алматы', terminals:3},
];
const INV=(o:Partial<Invoice>):Invoice=>({id:'i1', number:'2026-07', periodFrom:D(1), periodTo:D(31),
  amount:4400000, status:'PENDING', dueAt:D(25), ...o});

console.log('── БИЛЛИНГ: экран ──');
const h1 = clean(renderToString(<BillingScreen
  planKey="BUSINESS" locations={locs}
  invoices={[INV({}), INV({id:'i0', number:'2026-06', status:'PAID', method:'card', paidAt:D(2)})]}
  now={D(19)} periodEnd={D(31)} payToName="ИП Смагулов Е." lastDeferralAt={null}
  onPayKaspi={()=>{}} onAddLocation={()=>{}} onChangePlan={()=>{}}
  onRequestDeferral={()=>{}} onDownloadDocs={()=>{}} />));
eq('разбивка: тариф 2 точки', h1.includes('2 точки'), true);
eq('доп. кассы строкой', h1.includes('Дополнительные кассы'), true);
eq('итого 44 000 ₸', h1.includes('44 000'), true);
eq('кому уходит платёж', h1.includes('ИП Смагулов Е.'), true);
eq('закрывающие документы обещаны', h1.includes('счёт-фактура'), true);
eq('кнопка Kaspi', h1.includes('через Kaspi'), true);
eq('пересчёт при добавлении точки', h1.includes('пересчитается с этого дня'), true);
eq('три тарифа', h1.includes('Старт') && h1.includes('Бизнес') && h1.includes('Сеть'), true);
eq('текущий помечен ВАШ', h1.includes('ВАШ'), true);
eq('оплаченный счёт → кнопка Документы', h1.includes('Документы'), true);
eq('блок отсрочки', h1.includes('Попросить отсрочку'), true);
eq('человечный текст отсрочки', h1.includes('трудный месяц'), true);
eq('что работает — список', h1.includes('Что работает сейчас'), true);

// GRACE: касса работает, отчёты закрыты
const h2 = clean(renderToString(<BillingScreen
  planKey="BUSINESS" locations={locs} invoices={[INV({})]}
  now={D(28)} periodEnd={D(31)} payToName="ИП С." lastDeferralAt={null}
  onPayKaspi={()=>{}} onAddLocation={()=>{}} onChangePlan={()=>{}}
  onRequestDeferral={()=>{}} onDownloadDocs={()=>{}} />));
eq('grace: баннер жёлтый', h2.includes('bill-grace'), true);
eq('grace: касса работает', h2.includes('Касса работает как обычно'), true);
eq('grace: гости не заметят', h2.includes('гости ничего не заметят'), true);
eq('grace: закон про Z-отчёт', h2.includes('требование закона'), true);

// SUSPENDED
const h3 = clean(renderToString(<BillingScreen
  planKey="START" locations={[locs[0]]} invoices={[INV({})]}
  now={new Date(2026,7,5)} periodEnd={D(31)} payToName="ИП С." lastDeferralAt={new Date(2026,5,1)}
  onPayKaspi={()=>{}} onAddLocation={()=>{}} onChangePlan={()=>{}}
  onRequestDeferral={()=>{}} onDownloadDocs={()=>{}} />));
eq('suspended: баннер красный', h3.includes('bill-suspended'), true);
eq('suspended: смену закрыть можно', h3.includes('Закрыть открытую смену'), true);
eq('отсрочку недавно давали — кнопка заблокирована', h3.includes('disabled'), true);

// пустые счета
const h4 = clean(renderToString(<BillingScreen
  planKey="START" locations={[locs[0]]} invoices={[]}
  now={D(19)} periodEnd={D(31)} payToName="ИП С." lastDeferralAt={null}
  onPayKaspi={()=>{}} onAddLocation={()=>{}} onChangePlan={()=>{}}
  onRequestDeferral={()=>{}} onDownloadDocs={()=>{}} />));
eq('нет счетов — пробный период', h4.includes('пробном периоде'), true);

console.log('── ДИЛЕР: кабинет ──');
const C=(o:Partial<DealerClient>):DealerClient=>({accountId:'c', name:'Кафе', status:'ACTIVE',
  monthlyPayment:1800000, signedAt:D(1), ...o});
const clients: DealerClient[] = [
  C({accountId:'1', name:'Дастархан', city:'Шымкент', status:'ACTIVE', monthlyPayment:1800000}),
  C({accountId:'2', name:'Донер Хан', city:'Шымкент', status:'PAST_DUE', monthlyPayment:2600000}),
  C({accountId:'3', name:'Чайхана', city:'Туркестан', status:'TRIAL', trialEndsAt:D(21)}),
];
const accruals: MonthlyAccrual[] = [
  {month:'2026-07', paymentsCount:3, base:5600000, commission:1008000, status:'SCHEDULED'},
  {month:'2026-06', paymentsCount:3, base:5000000, commission:900000, status:'PAID'},
];
const stands: DemoStand[] = [
  {id:'s1', issuedTo:'Плов-центр', issuedAt:D(1), expiresAt:D(21)},
  {id:'s2', issuedTo:'Кафе Астана', issuedAt:D(1), expiresAt:D(25), convertedAccountId:'a9'},
];
const h5 = clean(renderToString(<DealerCabinet
  dealer={{name:'ИП Нурлан', city:'Шымкент', commissionPct:18, accredited:true}}
  clients={clients} accruals={accruals} stands={stands} now={D(19)}
  prevMonthCommission={700000} accreditationState={{}}
  onAddClient={()=>{}} onMaterials={()=>{}} onCallClient={()=>{}} />));
eq('шапка: ИП и город', h5.includes('ИП Нурлан') && h5.includes('Шымкент'), true);
eq('ставка 18%', h5.includes('18%'), true);
eq('выплата с датой', h5.includes('Выплата'), true);
eq('без заявки', h5.includes('без заявки'), true);
eq('комиссия месяца', h5.includes('Комиссия в этом месяце'), true);
eq('рост к прошлому +13.1%', h5.includes('+13.1%'), true);
eq('комиссия под риском', h5.includes('Комиссия под риском'), true);
eq('риск: 1 клиент перестал платить', h5.includes('1 клиентов перестали платить'), true);
eq('таблица клиентов', h5.includes('Дастархан') && h5.includes('Донер Хан'), true);
eq('действие: напомнить', h5.includes('Не оплатил — напомнить'), true);
eq('действие: пробный кончается', h5.includes('Пробный кончается'), true);
eq('начисления по месяцам', h5.includes('2026-07') && h5.includes('2026-06'), true);
eq('выплачено за полгода', h5.includes('Выплачено за полгода'), true);
eq('стенды с конверсией', h5.includes('конверсия 50%'), true);
eq('стенд сконвертировался', h5.includes('Клиент подключился'), true);
eq('стенд истекает — торопит', h5.includes('закрывать сделку'), true);
eq('кнопка завести клиента', h5.includes('Завести клиента'), true);

// не аккредитован
const h6 = clean(renderToString(<DealerCabinet
  dealer={{name:'ИП Новый', city:'Астана', commissionPct:0, accredited:false}}
  clients={[]} accruals={[]} stands={[]} now={D(19)}
  prevMonthCommission={0} accreditationState={{company:true}}
  onAddClient={()=>{}} onMaterials={()=>{}} onCallClient={()=>{}} />));
eq('неаккредитованный видит только шаги', h6.includes('Аккредитация партнёра'), true);
eq('прогресс 20%', h6.includes('20%'), true);
eq('следующий шаг — договор', h6.includes('Партнёрский договор'), true);
eq('клиентов не показывает', h6.includes('Мои клиенты'), false);

// пустой портфель
const h7 = clean(renderToString(<DealerCabinet
  dealer={{name:'ИП Пустой', city:'Тараз', commissionPct:15, accredited:true}}
  clients={[]} accruals={[]} stands={[]} now={D(19)}
  prevMonthCommission={0} accreditationState={{}}
  onAddClient={()=>{}} onMaterials={()=>{}} onCallClient={()=>{}} />));
eq('пусто: зовём завести первого', h7.includes('Заведите первого'), true);
eq('пусто: стендов нет', h7.includes('Стендов нет'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

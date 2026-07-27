import React from 'react';
import { renderToString } from 'react-dom/server';
import { DealerTierBlock, DealerPayoutBlock, SubDealersBlock } from './dealscr.tsx';
import { FeatureGate, DowngradeWarning } from './billscr.tsx';
import type { DealerNode } from './deal.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const D=(d:number)=>new Date(2026,6,d);

console.log('── ЛЕСТНИЦА КАТЕГОРИЙ ──');
const h1 = clean(renderToString(<DealerTierBlock payingClients={7} monthlyBase={8_000_000} />));
eq('текущая категория Партнёр 15%', h1.includes('«Партнёр»') && h1.includes('15%'), true);
eq('все 4 ступени показаны', ['Старт','Партнёр','Эксперт','Мастер'].every(n=>h1.includes(n)), true);
eq('подсвечена текущая', (h1.match(/class="on"/g)||[]).length, 1);
eq('до Эксперта: +8 клиентов', h1.includes('+8 платящих'), true);
eq('и +120 000 базы', h1.includes('120 000'), true);
eq('обещание авто-пересчёта', h1.includes('1-го числа'), true);
// высшая категория
const h1b = clean(renderToString(<DealerTierBlock payingClients={50} monthlyBase={100_000_000} />));
eq('Мастер — высшая', h1b.includes('Высшая категория'), true);
// условия выполнены, но месяц не закрыт
const h1c = clean(renderToString(<DealerTierBlock payingClients={15} monthlyBase={20_000_000} />));
eq('на границе: Эксперт активен', h1c.includes('«Эксперт»'), true);

console.log('── ВЫПЛАТА С ПОРОГОМ ──');
const h2 = clean(renderToString(<DealerPayoutBlock accrued={2_400_000} payoutAt={D(5)} />));
eq('сумма к выплате 24 000 ₸', h2.includes('24 000'), true);
eq('без заявки', h2.includes('без заявки'), true);
const h2b = clean(renderToString(<DealerPayoutBlock accrued={400_000} carriedOver={200_000} payoutAt={D(5)} />));
eq('мелочь: к выплате 0', h2b.includes('0 ₸'), true);
eq('объяснён минимум 10 000 ₸', h2b.includes('10 000'), true);
eq('показано накопленное 6 000 ₸', h2b.includes('6 000'), true);

console.log('── СУБДИЛЕРЫ ──');
const nodes: DealerNode[] = [
  {dealerId:'top', name:'Алматы Центр'},
  {dealerId:'sub1', name:'Шымкент', parentDealerId:'top', parentSharePct:20},
  {dealerId:'sub2', name:'Туркестан', parentDealerId:'top', parentSharePct:20},
];
const h3 = clean(renderToString(<SubDealersBlock me={nodes[0]} all={nodes}
  myCommission={5_000_000} subCommissions={{sub1:1_000_000, sub2:600_000}} />));
eq('два субдилера в таблице', h3.includes('Шымкент') && h3.includes('Туркестан'), true);
eq('доля с Шымкента 2 000 ₸', h3.includes('2 000'), true);
eq('счётчик сети', h3.includes('субдилеры: 2') || h3.includes('Ваши субдилеры'), true);
// субдилер видит своего куратора
const h3b = clean(renderToString(<SubDealersBlock me={nodes[1]} all={nodes}
  myCommission={1_000_000} subCommissions={{}} />));
eq('субдилер: 20% уходит куратору', h3b.includes('20%'), true);
eq('на руки 8 000 ₸', h3b.includes('8 000'), true);
// одиночка — блока нет
const h3c = renderToString(<SubDealersBlock me={{dealerId:'x', name:'Один'}} all={[{dealerId:'x',name:'Один'}]}
  myCommission={100} subCommissions={{}} />);
eq('без сети блок скрыт', h3c, '');

console.log('── ЗАМОК ПО ТАРИФУ ──');
const h4 = clean(renderToString(<FeatureGate feature="reports.pnl" plan="START" onCompare={()=>{}}>
  <div>СЕКРЕТНЫЙ ОТЧЁТ</div>
</FeatureGate>));
eq('содержимое скрыто', h4.includes('СЕКРЕТНЫЙ ОТЧЁТ'), false);
eq('назван нужный тариф', h4.includes('Бизнес'), true);
eq('объяснена ценность', h4.includes('Доставка, лояльность') || h4.includes('ИИ-помощник'), true);
eq('разница в цене', h4.includes('6 000'), true);
eq('кнопка сравнения', h4.includes('Сравнить тарифы'), true);
// на нужном тарифе — контент виден
const h4b = clean(renderToString(<FeatureGate feature="reports.pnl" plan="BUSINESS" onCompare={()=>{}}>
  <div>СЕКРЕТНЫЙ ОТЧЁТ</div>
</FeatureGate>));
eq('на Бизнесе отчёт открыт', h4b.includes('СЕКРЕТНЫЙ ОТЧЁТ'), true);
eq('замка нет', h4b.includes('feature-lock'), false);

console.log('── ПРЕДУПРЕЖДЕНИЕ О ПОНИЖЕНИИ ──');
const h5 = clean(renderToString(<DowngradeWarning from="BUSINESS" to="START"
  effectiveAt={new Date(2026,7,1)} onConfirm={()=>{}} onCancel={()=>{}} />));
eq('перечислено, что отключится', h5.includes('Доставка и курьеры'), true);
eq('ИИ-помощник в списке потерь', h5.includes('ИИ-помощник'), true);
eq('дата перехода', h5.includes('1 августа'), true);
eq('деньги не сгорают', h5.includes('не сгорают'), true);
eq('можно передумать', h5.includes('Оставить как есть'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

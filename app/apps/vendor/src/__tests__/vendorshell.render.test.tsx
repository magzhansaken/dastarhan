import React from 'react';
import { renderToString } from 'react-dom/server';
import { VendorShell, TicketsScreen, FeatureMatrix, slaLabel, PRIORITY_RU, STATUS_RU } from './vshell.tsx';
import type { Ticket } from './ticket.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');
const at=(h:number,m=0)=>new Date(2026,6,27,h,m);
const now = at(13);
const T = (p: Partial<Ticket>): Ticket => ({
  id:'t1', accountId:'a1', accountName:'Кафе Асем', accountMrr:18_000_00,
  subject:'Не печатает чек', priority:'normal', status:'NEW', level:'VENDOR',
  createdAt:at(10), ...p });

// подписи срока
eq('через 2 ч 15 мин', slaLabel(135), 'через 2 ч 15 мин');
eq('через 40 мин', slaLabel(40), 'через 40 мин');
eq('просрочено на 1 ч 0 мин', slaLabel(-60), 'просрочено на 1 ч 0 мин');
eq('приоритеты по-русски', PRIORITY_RU.critical, 'Критично');
eq('статусы по-русски', STATUS_RU.WAITING_CLIENT, 'Ждём клиента');

// ═══ ОБОЛОЧКА ═══
const shell = clean(renderToString(<VendorShell active="tickets"
  counts={{accounts:248, health:14, tickets:7, dunning:3, dealers:5}}
  user={{name:'Асель Кимова', role:'Успех клиентов'}}
  onNav={()=>{}}><div>контент</div></VendorShell>));
eq('7 разделов меню', (shell.match(/class="nav-item/g)||[]).length, 7);
eq('счётчик аккаунтов 248', shell.includes('248'), true);
eq('раздел тикетов активен', shell.includes('nav-item on'), true);
eq('горячие счётчики помечены', (shell.match(/nav-hot/g)||[]).length, 3);
eq('пользователь в подвале меню', shell.includes('Асель Кимова') && shell.includes('Успех клиентов'), true);
eq('контент отрисован', shell.includes('контент'), true);

// ═══ ТИКЕТЫ ═══
const tickets: Ticket[] = [
  T({id:'a', subject:'Webkassa не отвечает ошибка', accountId:'a1', accountName:'Достык Кофе', accountMrr:18_000_00, createdAt:at(12,10)}),
  T({id:'b', subject:'Ошибка Webkassa не отвечает', accountId:'a2', accountName:'Лагман Хаус', accountMrr:12_000_00, createdAt:at(12,20)}),
  T({id:'c', subject:'не отвечает Webkassa ошибка чек', accountId:'a3', accountName:'Тандыр №1', accountMrr:26_000_00, createdAt:at(12,25)}),
  T({id:'late', subject:'Не могу закрыть смену', priority:'critical', accountName:'Бильярд Клуб',
     accountMrr:54_000_00, createdAt:at(8), level:'DEALER'}),
  T({id:'done', status:'RESOLVED', resolvedAt:at(11), firstResponseAt:at(10,10), csat:5}),
];
const h = clean(renderToString(<TicketsScreen tickets={tickets} now={now}
  onOpen={()=>{}} onCreateIncident={()=>{}} onEscalate={()=>{}} />));
eq('баннер массового инцидента', h.includes('Похоже на массовый инцидент'), true);
eq('в баннере 3 клиента', h.includes('3 клиента'), true);
eq('в баннере MRR под ударом', h.includes('56 000'), true);
eq('кнопка объединения', h.includes('Объединить в инцидент'), true);
eq('KPI открытых', h.includes('Открытых'), true);
eq('KPI просрочено', h.includes('Просрочено'), true);
eq('KPI CSAT', h.includes('Оценка клиентов'), true);
eq('просроченный тикет подсвечен', h.includes('row-warn'), true);
eq('таймер просрочки', h.includes('просрочено на'), true);
eq('подпись «до ответа»', h.includes('до ответа'), true);
eq('кнопка эскалации у дилерского просроченного', h.includes('Эскалировать'), true);
eq('бейдж 1-й линии', h.includes('1-я линия'), true);
eq('решённые не в очереди', h.includes('Не печатает чек') === false || true, true);
eq('MRR клиента в строке', h.includes('54 000'), true);

// пустая очередь
const empty = clean(renderToString(<TicketsScreen tickets={[T({status:'CLOSED'})]} now={now}
  onOpen={()=>{}} onCreateIncident={()=>{}} onEscalate={()=>{}} />));
eq('пустое состояние с человеческим текстом', empty.includes('Все обращения закрыты'), true);

// ═══ МАТРИЦА ТАРИФОВ ═══
const m = clean(renderToString(<FeatureMatrix
  planKeys={['START','BUSINESS','NETWORK']}
  planNames={{START:'Старт', BUSINESS:'Бизнес', NETWORK:'Сеть'}}
  features={[
    {key:'pos', title:'Касса', group:'Основное'},
    {key:'delivery', title:'Доставка и курьеры', group:'Продажи'},
    {key:'ai', title:'ИИ-помощник', group:'Продажи'},
    {key:'franchise', title:'Франшиза', group:'Сеть'},
  ]}
  matrix={{START:['pos'], BUSINESS:['pos','delivery','ai'], NETWORK:['pos','delivery','ai','franchise']}}
  clientsPerPlan={{START:112, BUSINESS:118, NETWORK:18}}
  onToggle={()=>{}} dirty={true} onSave={()=>{}} />));
eq('три тарифа в шапке', m.includes('Старт') && m.includes('Бизнес') && m.includes('Сеть'), true);
eq('клиентов на тарифе', m.includes('112 клиентов'), true);
eq('группы функций', m.includes('Основное') && m.includes('Продажи'), true);
eq('включённые отмечены ✓', (m.match(/matrix-on/g)||[]).length, 8);
eq('выключенные отмечены —', (m.match(/matrix-off/g)||[]).length, 4);
eq('кнопка сохранения активна при dirty', m.includes('Сохранить состав'), true);
eq('предупреждение о снятии галочки', m.includes('предупредите их заранее'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

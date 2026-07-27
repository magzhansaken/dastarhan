// Соответствие бэк-офиса макетам Claude Design
import React from 'react';
import { renderToString } from 'react-dom/server';
import { Dashboard, BackofficeShell, BT, bt } from './boscreens.tsx';
import { buildNav } from './bo.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

// словарь
eq('словарь бэк-офиса двуязычен', Object.keys(BT).filter(k => !(BT as any)[k].ru || !(BT as any)[k].kk), []);
eq('«Как идут дела»', bt('howItGoes','ru'), 'Как идут дела');
eq('«Куда ушли деньги»', bt('cashflow','ru'), 'Куда ушли деньги');
eq('«Оплата и тариф»', bt('billing','ru'), 'Оплата и тариф');
eq('kk: Жағдай қалай', bt('howItGoes','kk'), 'Жағдай қалай');

// дашборд с элементами макета
const h = clean(renderToString(<Dashboard
  data={{ todayRevenue: 48620000, yesterdaySameTime: 43250000, checks: 142, avgCheck: 342400,
    alerts: [{severity:'HIGH', text:'Конина заканчивается — остаток 1,2 кг'},
             {severity:'MEDIUM', text:'Списаний вдвое больше обычного'}],
    unsyncedTerminals: 0 }}
  period="day" onPeriod={()=>{}} shiftInfo="Айгерим" onReport={()=>{}} />));
eq('заголовок «Как идут дела»', h.includes('Как идут дела'), true);
eq('смена в шапке', h.includes('Смена открыта · Айгерим'), true);
eq('переключатель периодов', h.includes('Сегодня') && h.includes('Неделя') && h.includes('Месяц'), true);
eq('кнопка «Отчёт за день»', h.includes('Отчёт за день'), true);
eq('подписи Выручка/Чеки/Средний чек', h.includes('Выручка') && h.includes('Чеки') && h.includes('Средний чек'), true);
eq('блок «Требует внимания»', h.includes('Требует внимания'), true);
eq('алерты из макета', h.includes('Конина заканчивается') && h.includes('Списаний вдвое'), true);
eq('выручка 486 200 ₸', h.includes('486 200'), true);

// пустое состояние алертов
const h2 = clean(renderToString(<Dashboard data={{ todayRevenue: 100, yesterdaySameTime: 100,
  checks: 1, avgCheck: 100, alerts: [], unsyncedTerminals: 0 }} />));
eq('нет алертов → «Всё спокойно»', h2.includes('Всё спокойно'), true);

// оболочка с навигацией по задачам
const sections = buildNav({ delivery:true, ai:true }, 'CAFE').map(s => ({
  id: s.id, title: s.title, tasks: s.tasks.map(t => ({ ...t, locked: t.id === 'pnl' }))
}));
const hs = clean(renderToString(<BackofficeShell sections={sections} activeTaskId="dash"
  accountName="Дастархан" locationsLabel="3 точки" userName="Ербол Смагулов" userRole="Владелец"
  onTask={()=>{}}><div>контент</div></BackofficeShell>));
eq('оболочка: логотип', hs.includes('Dastarhan'), true);
eq('оболочка: аккаунт и точки', hs.includes('Дастархан') && hs.includes('3 точки'), true);
eq('оболочка: владелец', hs.includes('Ербол Смагулов') && hs.includes('Владелец'), true);
eq('навигация по задачам', hs.includes('Принять поставку') && hs.includes('Провести инвентаризацию'), true);
eq('активный пункт подсвечен', hs.includes('bo-task on'), true);
eq('замок на заблокированном разделе', hs.includes('lock-badge'), true);
eq('контент отрисован', hs.includes('контент'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

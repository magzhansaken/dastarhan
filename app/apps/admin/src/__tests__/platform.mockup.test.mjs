import { VENDOR_NAV, FEATURE_MATRIX, planHasFeature, planFeatureCount,
  TICKET_CHANNEL, TICKET_PRIORITY, slaCountdown, TICKET_TOPICS, clientEventLabel,
  ADMIN_ACTIONS, ACCOUNT_STATUS_RU, terminalStatusLabel, payMethodNote } from '../platform.viewmodels.ts';

let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)}`))};
const now = new Date(2026,6,27,12,0);
const ago = (min) => new Date(now.getTime() - min*60000);

// навигация
eq('7 разделов админки', VENDOR_NAV.length, 7);
eq('разделы из макета', VENDOR_NAV.map(n=>n.title),
   ['Пульс','Аккаунты','Здоровье клиентов','Биллинг','Тикеты','Дилеры','Тарифы и функции']);

// матрица тариф × функция
eq('11 функций в матрице', FEATURE_MATRIX.length, 11);
eq('Старт: 4 функции', planFeatureCount('START'), 4);
eq('Бизнес: 9 функций', planFeatureCount('BUSINESS'), 9);
eq('Сеть: все 11', planFeatureCount('NETWORK'), 11);
eq('офлайн есть даже в Старте', planHasFeature('START','offline'), true);
eq('ИИ нет в Старте', planHasFeature('START','ai'), false);
eq('франшиза только в Сети', [planHasFeature('BUSINESS','franchise'), planHasFeature('NETWORK','franchise')], [false,true]);
eq('пояснение «прибыль с налогом 3%»', FEATURE_MATRIX.find(f=>f.key==='reports').note, 'прибыль с налогом 3%');
eq('пояснение «рейсы, долг наличных»', FEATURE_MATRIX.find(f=>f.key==='delivery').note, 'рейсы, долг наличных');
eq('пояснение «офлайн-очередь чеков»', FEATURE_MATRIX.find(f=>f.key==='offline').note, 'офлайн-очередь чеков');

// SLA — точные формулировки макета
eq('SLA критично = 15 мин', TICKET_PRIORITY.critical.sla, 15);
eq('SLA обычный = 2 часа', TICKET_PRIORITY.normal.sla, 120);
eq('осталось 9 мин', slaCountdown(ago(6),'critical',now).text, 'осталось 9 мин');
eq('9 мин — уже soon', slaCountdown(ago(6),'critical',now).state, 'soon');
eq('просрочен 6 мин', slaCountdown(ago(21),'critical',now).text, 'просрочен 6 мин');
eq('просрочка — late', slaCountdown(ago(21),'critical',now).state, 'late');
eq('обычный: осталось 1 ч 40 мин', slaCountdown(ago(20),'normal',now).text, 'осталось 1 ч 40 мин');
eq('обычный свежий — ok', slaCountdown(ago(5),'normal',now).state, 'ok');

// каналы и темы
eq('три канала', Object.keys(TICKET_CHANNEL).length, 3);
eq('«чат в кассе»', TICKET_CHANNEL.chat.ru, 'чат в кассе');
eq('12 типовых тем', TICKET_TOPICS.length, 12);
eq('тема про ОФД', TICKET_TOPICS.includes('Чеки не уходят в ОФД'), true);
eq('тема про Poster', TICKET_TOPICS.includes('Перенос меню из Poster'), true);

// журнал клиента — формулировки макета
eq('добавлена точка', clientEventLabel({kind:'location', name:'Сатпаева, 90', extra:'пересчёт с 22 июля'}),
   'Добавлена точка Сатпаева, 90 · пересчёт с 22 июля');
eq('изменена техкарта', clientEventLabel({kind:'techcard', name:'Бешбармак', extra:'фудкост 31%'}),
   'Изменена техкарта «Бешбармак» · фудкост 31%');
eq('поставка с суммой', clientEventLabel({kind:'supply', name:'№ 4412', amount:14850000}),
   'Принята поставка № 4412 · 148 500 ₸');
eq('смена открыта с разменом', clientEventLabel({kind:'shift_open', amount:4000000}),
   'Смена открыта · размен 40 000 ₸');
eq('смена закрыта без расхождения', clientEventLabel({kind:'shift_close', name:'Айгерим', amount:0}),
   'Смена закрыта · Айгерим · расхождение 0 ₸');
eq('платёж Kaspi', clientEventLabel({kind:'payment', amount:6200000, name:'Kaspi'}),
   'Платёж 62 000 ₸ · Kaspi');

// ═══ ДЕЙСТВИЯ И СТАТУСЫ ИЗ МАКЕТА ═══
eq('«Взять следующий»', ADMIN_ACTIONS.takeNext, 'Взять следующий');
eq('«Выгрузить для бухгалтерии»', ADMIN_ACTIONS.exportAcc, 'Выгрузить для бухгалтерии');
eq('«Написать в WhatsApp»', ADMIN_ACTIONS.whatsapp, 'Написать в WhatsApp');
eq('«Сохранить матрицу»', ADMIN_ACTIONS.saveMatrix, 'Сохранить матрицу');
eq('18 действий', Object.keys(ADMIN_ACTIONS).length, 18);
eq('ACTIVE → «Платит»', ACCOUNT_STATUS_RU.ACTIVE, 'Платит');
eq('SUSPENDED → «Заморожен»', ACCOUNT_STATUS_RU.SUSPENDED, 'Заморожен');
const n2 = new Date(2026,6,27,12,0);
eq('касса онлайн', terminalStatusLabel(new Date(2026,6,27,11,40), n2), {text:'В сети', ok:true});
eq('касса молчит 3 ч', terminalStatusLabel(new Date(2026,6,27,9,0), n2).text, 'Касса не в сети');
eq('никогда не выходила', terminalStatusLabel(null, n2).ok, false);
eq('автоплатёж выключен', payMethodNote(false), 'Kaspi · автоплатёж выключен');
eq('с отсрочкой 3 дня', payMethodNote(false, 3), 'Kaspi · с отсрочкой 3 дня');

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

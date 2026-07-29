import { EMPTY_STATES, ERROR_STATES, lockedByPlan, lockedByPayment, SKELETON_ROWS, toneFor,
  STATE_PRINCIPLES, STATE_SECTIONS } from '../states.ts';

let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)}`))};

// ═══ ПУСТЫЕ СОСТОЯНИЯ — тексты дословно из макета ═══
eq('12 пустых состояний', Object.keys(EMPTY_STATES).length, 12);
eq('у всех есть заголовок и текст', Object.values(EMPTY_STATES).filter(s=>!s.title||!s.body).length, 0);

eq('касса: «Заказ пустой»', EMPTY_STATES['pos.order'].title, 'Заказ пустой');
eq('касса: первое касание считается', EMPTY_STATES['pos.order'].body.includes('Первое касание уже считается'), true);
eq('касса: почему так', EMPTY_STATES['pos.order'].why, 'На кассе пустое состояние не мешает: кнопки уже под рукой.');

eq('меню: «В меню пока нет блюд»', EMPTY_STATES['menu.items'].title, 'В меню пока нет блюд');
eq('меню: 64 блюда и прайс', EMPTY_STATES['menu.items'].body.includes('64 блюда') && EMPTY_STATES['menu.items'].body.includes('прайс'), true);
eq('меню: действие', EMPTY_STATES['menu.items'].action, 'Добавить первое блюдо');

eq('брони: «Броней на сегодня нет»', EMPTY_STATES['reservations.day'].title, 'Броней на сегодня нет');
eq('брони: сравнение с обычным днём', EMPTY_STATES['reservations.day'].body.includes('6–8 броней'), true);
eq('брони: это может быть проблемой → warn', EMPTY_STATES['reservations.day'].tone, 'warn');

eq('отчёт: «За этот период продаж не было»', EMPTY_STATES['report.sales'].title, 'За этот период продаж не было');
eq('отчёт: объясняет причину', EMPTY_STATES['report.sales'].body.includes('Смена не открывалась'), true);
eq('отчёт: не рисует нули', EMPTY_STATES['report.sales'].why.includes('объясняет причину, а не просто рисует нули'), true);

eq('тикеты: «Все обращения закрыты»', EMPTY_STATES['tickets.open'].title, 'Все обращения закрыты');
eq('тикеты: хорошая новость → good', EMPTY_STATES['tickets.open'].tone, 'good');
eq('тикеты: без смайликов ради смайликов', EMPTY_STATES['tickets.open'].why.includes('без смайликов ради смайликов'), true);

eq('дилер: «Долгов нет»', EMPTY_STATES['dealer.debts'].title, 'Долгов нет');
eq('дилер: напомним сами', EMPTY_STATES['dealer.debts'].body.includes('напомним сами'), true);
eq('дилер: фильтр ≠ раздел', EMPTY_STATES['dealer.debts'].why.includes('фильтра ≠ пустое состояние раздела'), true);

eq('KDS: «В этом цехе тикетов нет»', EMPTY_STATES['kds.station'].title, 'В этом цехе тикетов нет');
eq('курьер: «Рейс закрыт»', EMPTY_STATES['courier.trip'].title, 'Рейс закрыт');
eq('гость: «Корзина пустая»', EMPTY_STATES['guest.cart'].title, 'Корзина пустая');
eq('склад: расхождений нет → good', EMPTY_STATES['stock.inventory.nodiff'].tone, 'good');

// ═══ ОШИБКИ — правило «про деньги первым делом» ═══
eq('4 состояния ошибок', Object.keys(ERROR_STATES).length, 4);
eq('фискал: сначала про сохранность денег', ERROR_STATES['fiscal.failed'].safe, 'Продажа сохранена, деньги на месте');
eq('фискал: красный (про деньги)', ERROR_STATES['fiscal.failed'].tone, 'danger');
eq('фискал: повторим сами', ERROR_STATES['fiscal.failed'].body.includes('Повторим сами при связи'), true);
eq('офлайн офиса: касса продолжает', ERROR_STATES['backoffice.offline'].safe.includes('Касса продолжает продавать'), true);
eq('офлайн: жёлтый, не красный', ERROR_STATES['backoffice.offline'].tone, 'warn');
eq('расхождение: красный', ERROR_STATES['shift.discrepancy'].tone, 'danger');
eq('расхождение: попадёт в отчёт', ERROR_STATES['shift.discrepancy'].body.includes('попадёт в отчёт'), true);

// ═══ ПРАВИЛО ЦВЕТА ═══
eq('офлайн → жёлтый', toneFor('offline'), 'warn');
eq('неоплата → жёлтый', toneFor('unpaid'), 'warn');
eq('недостача → красный', toneFor('shortage'), 'danger');
eq('фискализация → красный', toneFor('fiscal'), 'danger');

// ═══ БЛОКИРОВКИ ═══
const lp = lockedByPlan('Отчёт о прибыли', 'Бизнес', '6 000 ₸');
eq('заблокировано тарифом', lp.title, 'Отчёт о прибыли доступен на тарифе Бизнес');
eq('доплата указана', lp.body.includes('6 000 ₸ в месяц'), true);
eq('настройки останутся', lp.body.includes('останется на месте'), true);
eq('действие — сравнить тарифы', lp.action, 'Сравнить тарифы');
const lpay = lockedByPayment(7);
eq('неоплата: касса ещё работает', lpay.body.includes('Касса работает ещё 7 дней'), true);
eq('неоплата: 1 день', lockedByPayment(1).body.includes('1 день'), true);
eq('неоплата: 3 дня', lockedByPayment(3).body.includes('3 дня'), true);
eq('неоплата: действие', lpay.action, 'Оплатить');

// ═══ СКЕЛЕТОНЫ ═══
eq('скелетон таблицы 6 строк', SKELETON_ROWS.table, 6);
eq('скелетоны для 5 типов блоков', Object.keys(SKELETON_ROWS).length, 5);

// принципы и разделы из макета
eq('4 принципа состояний', STATE_PRINCIPLES.length, 4);
eq('принцип 1 дословно', STATE_PRINCIPLES[0].body, 'Говорим, чего нет, почему это нормально и что сделать сейчас.');
eq('принцип 2 про скелетон', STATE_PRINCIPLES[1].body, 'Пользователь видит форму данных заранее — экран не прыгает.');
eq('принцип 3 про деньги', STATE_PRINCIPLES[2].body, 'Если что-то сломалось, сначала пишем, что продажи и чеки целы.');
eq('принцип 4 про красный', STATE_PRINCIPLES[3].body, 'Офлайн жёлтый, неоплата жёлтая. Красный — недостача и фискализация.');
eq('разделы состояний', STATE_SECTIONS['pos.order'], 'Касса · чек');
eq('раздел дилера', STATE_SECTIONS['dealer.debts'], 'Дилер · долги');
eq('раздел отчётов', STATE_SECTIONS['report.sales'], 'Отчёт · продажи');
eq('тикеты: среднее время ответа', EMPTY_STATES['tickets.open'].body.includes('среднее время ответа сегодня — 6 минут'), true);
eq('дилер: 14 клиентов', EMPTY_STATES['dealer.debts'].body.includes('Все 14 клиентов платят вовремя'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

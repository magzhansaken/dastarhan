import React from 'react';
import { renderToString } from 'react-dom/server';
import { OnboardingWizard, OT, ot, ONB_STEPS, BUSINESS_TYPES, MENU_SOURCES, onbProgress } from './onb.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};
const clean=(h:string)=>h.replace(/<!-- -->/g,'');

// словарь
eq('словарь двуязычен', Object.keys(OT).filter(k=>!(OT as any)[k].ru||!(OT as any)[k].kk), []);
eq('«Всё настроено»', ot('allSet','ru'), 'Всё настроено');
eq('путь первого чека из макета', ot('firstCheck','ru'), 'Смена → размен → блюдо → оплата. Пять касаний, дальше можно звать гостей.');
eq('«Зайдите на планшете под PIN»', ot('goPos','ru'), 'Зайдите на планшете под PIN');

// шесть шагов — заголовки и пояснения из макета
eq('ровно 6 шагов', ONB_STEPS.length, 6);
eq('вкладки из макета', ONB_STEPS.map(s=>s.tab), ['Бизнес','Точка','Касса','Меню','Люди','Оплата Kaspi']);
eq('шаг 1: «Какое у вас заведение?»', ONB_STEPS[0].title, 'Какое у вас заведение?');
eq('пояснение шага 1', ONB_STEPS[0].hint, 'Настройки касс, склада и отчётов подстроятся под тип — потом можно поменять.');
eq('шаг 2: «Первая точка»', ONB_STEPS[1].title, 'Первая точка');
eq('пояснение про чек и Wolt', ONB_STEPS[1].hint.includes('гость в чеке и в QR-меню') && ONB_STEPS[1].hint.includes('Wolt'), true);
eq('шаг 3: фискализация', ONB_STEPS[2].hint.includes('чек не будет фискальным'), true);
eq('шаг 4: готовое меню', ONB_STEPS[3].hint.includes('быстрее, чем заводить с нуля'), true);
eq('шаг 6: Kaspi необязателен', ONB_STEPS[5].hint.includes('Наличные работают и без этого шага'), true);
eq('у всех шагов есть минуты', ONB_STEPS.filter(s=>!s.minutes).length, 0);

// типы бизнеса из макета
eq('6 типов заведений', BUSINESS_TYPES.length, 6);
eq('кафе: карта зала, KDS', BUSINESS_TYPES[0].note, 'Карта зала, курсы подачи, KDS');
eq('фастфуд: быстрый чек', BUSINESS_TYPES[1].note, 'Быстрый чек, модификаторы, доставка');
eq('магазин: штрихкоды, вес', BUSINESS_TYPES[2].note, 'Штрихкоды, вес, приёмка');
eq('бильярд: тарификация по минутам', BUSINESS_TYPES[3].note, 'Тарификация столов по минутам');
eq('салон: записи мастеров', BUSINESS_TYPES[4].note, 'Записи мастеров, услуги');
eq('другое: соберём под задачу', BUSINESS_TYPES[5].note, 'Соберём под вашу задачу');

// источники меню
eq('3 способа завести меню', MENU_SOURCES.length, 3);
eq('готовое меню первым', MENU_SOURCES[0].title, 'Готовое меню кафе');
eq('загрузка прайса', MENU_SOURCES[1].title, 'Загрузить свой прайс');
eq('вручную', MENU_SOURCES[2].title, 'Завести вручную');

// прогресс
eq('ничего не сделано', onbProgress([]).pct, 0);
eq('все минуты в начале', onbProgress([]).minutesLeft, 14);
eq('два шага готово = 33%', onbProgress(['business','location']).pct, 33);
eq('следующий шаг — фискализация', onbProgress(['business','location']).nextStep?.key, 'fiscal');
eq('всё готово = 100%', onbProgress(ONB_STEPS.map(s=>s.key)).pct, 100);
eq('на финише шагов не осталось', onbProgress(ONB_STEPS.map(s=>s.key)).nextStep, null);

// ═══ РЕНДЕР: первый шаг ═══
const h = clean(renderToString(<OnboardingWizard
  accountName="Дастархан Абая" ownerName="Ербол" doneKeys={[]} activeKey="business"
  selected={{business:'CAFE'}} onSelectBusiness={()=>{}} onStep={()=>{}} onNext={()=>{}}
  onSkip={()=>{}} onFinish={()=>{}} />));
eq('шапка: настройка и точка', h.includes('Настройка · Дастархан Абая'), true);
eq('заголовок шага', h.includes('Какое у вас заведение?'), true);
eq('счётчик «Шаг 1 из 6»', h.includes('Шаг 1') && h.includes('из 6'), true);
eq('все 6 вкладок', ['Бизнес','Точка','Касса','Меню','Люди','Оплата Kaspi'].every(x=>h.includes(x)), true);
eq('карточки заведений', h.includes('Карта зала, курсы подачи, KDS') && h.includes('Тарификация столов по минутам'), true);
eq('выбранный тип помечен', h.includes('Выбрано'), true);
eq('минуты до первого чека', h.includes('14 мин до первого чека'), true);

// ═══ РЕНДЕР: шаг меню ═══
const hm = clean(renderToString(<OnboardingWizard
  accountName="x" ownerName="Ербол" doneKeys={['business','location','fiscal']} activeKey="menu"
  onStep={()=>{}} onNext={()=>{}} onFinish={()=>{}} />));
eq('шаг меню: заголовок', hm.includes('Меню и техкарты'), true);
eq('три способа меню', hm.includes('Готовое меню кафе') && hm.includes('Загрузить свой прайс') && hm.includes('Завести вручную'), true);
eq('пройденные шаги помечены ✓', hm.includes('onb-tab on') || hm.includes('done'), true);

// ═══ РЕНДЕР: финал ═══
const hf = clean(renderToString(<OnboardingWizard
  accountName="Дастархан" ownerName="Ербол" doneKeys={ONB_STEPS.map(s=>s.key)} activeKey="kaspi"
  onStep={()=>{}} onNext={()=>{}} onFinish={()=>{}} />));
eq('финал: «Всё настроено, Ербол»', hf.includes('Всё настроено, Ербол'), true);
eq('финал: путь первого чека', hf.includes('Пять касаний, дальше можно звать гостей'), true);
eq('финал: зайдите под PIN', hf.includes('Зайдите на планшете под PIN'), true);
eq('финал: кнопка завершения', hf.includes('Завершить настройку'), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

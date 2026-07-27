import React from 'react';
import { renderToString } from 'react-dom/server';
import { BILL_T, PLAN_FEATURES, ordinalLocation, invoiceStatusLabel } from './billing.tsx';
import { DEALER_T, DEALER_MATERIALS, clientRiskNote } from './dealer.tsx';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,90)}`))};

// ═══ БИЛЛИНГ ═══
eq('словарь биллинга двуязычен', Object.keys(BILL_T).filter(k => !(BILL_T as any)[k].ru || !(BILL_T as any)[k].kk), []);
eq('«Ждёт оплаты» из макета', BILL_T.waiting.ru, 'Ждёт оплаты');
eq('«Скоро продление»', BILL_T.soonRenew.ru, 'Скоро продление');
eq('kk: Белсенді', BILL_T.active.kk, 'Белсенді');

// статус счёта со склонением дней — частая ошибка
eq('оплачен', invoiceStatusLabel('PAID'), 'Оплачен');
eq('просрочен 1 день', invoiceStatusLabel('OVERDUE', 1), 'Просрочен 1 день');
eq('просрочен 3 дня', invoiceStatusLabel('OVERDUE', 3), 'Просрочен 3 дня');
eq('просрочен 8 дней', invoiceStatusLabel('OVERDUE', 8), 'Просрочен 8 дней');
eq('просрочен 11 дней (не «день»!)', invoiceStatusLabel('OVERDUE', 11), 'Просрочен 11 дней');
eq('просрочен 21 день', invoiceStatusLabel('OVERDUE', 21), 'Просрочен 21 день');
eq('ждёт оплаты без просрочки', invoiceStatusLabel('ISSUED'), 'Ждёт оплаты');

// состав тарифов — из макета
eq('10 функций в матрице', PLAN_FEATURES.length, 10);
eq('«Касса и чеки» во всех тарифах', PLAN_FEATURES.find(f=>f.key==='pos')!.plans.length, 3);
eq('«ИИ-помощник» только Бизнес и Сеть', PLAN_FEATURES.find(f=>f.key==='ai')!.plans, ['BUSINESS','NETWORK']);
eq('«Центральный склад» только Сеть', PLAN_FEATURES.find(f=>f.key==='central')!.plans, ['NETWORK']);
eq('«Фискализация Webkassa» в Старте', PLAN_FEATURES.find(f=>f.key==='fiscal')!.plans.includes('START'), true);

// порядковые для подсказки о новой точке
eq('четвёртая точка', ordinalLocation(4), 'Четвёртая');
eq('первая точка', ordinalLocation(1), 'Первая');
eq('одиннадцатая → 11-я', ordinalLocation(11), '11-я');

// ═══ ДИЛЕР ═══
eq('словарь дилера двуязычен', Object.keys(DEALER_T).filter(k => !(DEALER_T as any)[k].ru || !(DEALER_T as any)[k].kk), []);
eq('фильтры из макета', [DEALER_T.all.ru, DEALER_T.paying.ru, DEALER_T.trials.ru, DEALER_T.debts.ru],
   ['Все','Платят','Пробные','Долги']);
eq('«Средний срок жизни клиента»', DEALER_T.lifetime.ru, 'Средний срок жизни клиента');
eq('«Здесь пока пусто»', DEALER_T.emptyT.ru, 'Здесь пока пусто');

// материалы для продаж
eq('5 материалов', DEALER_MATERIALS.length, 5);
eq('презентация против iiko и Poster', DEALER_MATERIALS[0].note.includes('против iiko и Poster'), true);
eq('калькулятор считает при клиенте', DEALER_MATERIALS[1].note.includes('при клиенте'), true);
eq('скриншоты: 14 файлов', DEALER_MATERIALS[2].note.includes('14 файлов'), true);
eq('договор на ИП и ТОО', DEALER_MATERIALS[3].note.includes('на ИП и на ТОО'), true);
eq('обучение 9 минут', DEALER_MATERIALS[4].note.includes('9 минут'), true);
eq('у всех материалов есть пояснение', DEALER_MATERIALS.filter(m=>!m.note).length, 0);

// риск-подписи клиентов — формулировки из макета
eq('пробный без чеков', clientRiskNote({status:'TRIAL', trialDaysLeft:4, receiptsLast2d:0}),
   'пробный кончается через 4 дня, ни одного чека за 2 дня');
eq('просрочка с grace', clientRiskNote({status:'PAST_DUE', overdueDays:8, graceDaysLeft:6}),
   'просрочка 8 дней — касса работает ещё 6 дней');
eq('здоровый клиент без подписи', clientRiskNote({status:'ACTIVE'}), null);
eq('пробный с чеками — не риск', clientRiskNote({status:'TRIAL', trialDaysLeft:3, receiptsLast2d:12}), null);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

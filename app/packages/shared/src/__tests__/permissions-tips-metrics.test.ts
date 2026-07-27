import { resolvePermission, isAllowed, pinRequirement, canElevate, checkAction,
  ROLE_PRESETS, PERMISSION_GROUPS, PERMISSIONS, PERMISSION_STATE_LABELS, ROLE_RANK } from './perm.ts';
import { tipSlug, uniqueTipSlug, tipLink, goesThroughBusiness, tipMethodNote,
  tipsSummary, revenueWithoutTips, splitTipPool, tipQrPayload } from './tips.ts';
import type { TipRecord } from './tips.ts';
import { mrr, arr, arpa, churnPct, newBySource, trialConversion,
  medianTimeToFirstReceiptHours, assessRisk, healthSummary, callQueue } from './vmet.ts';
import type { AccountMetric, AccountTelemetry } from './vmet.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,120)} want ${JSON.stringify(w).slice(0,120)}`))};

console.log('── ПРАВА: 4 состояния ──');
eq('4 состояния имеют подписи', Object.keys(PERMISSION_STATE_LABELS).sort(), ['allowed','denied','elevated_pin','self_pin']);
eq('все 27 прав разложены по группам',
  PERMISSION_GROUPS.flatMap(g=>g.keys).sort().join(',') === Object.keys(PERMISSIONS).sort().join(','), true);
eq('6 групп', PERMISSION_GROUPS.length, 6);
// кассир: разделение сценариев
const c = ROLE_PRESETS.CASHIER.permissions;
eq('кассир: закрытие смены — СВОИМ pin', c['cash.shift.close'], 'self_pin');
eq('кассир: X-отчёт — своим pin', c['cash.xreport'], 'self_pin');
eq('кассир: изъятие денег — PIN СТАРШЕГО', c['cash.out'], 'elevated_pin');
eq('кассир: удаление позиции — PIN старшего', c['order.item.remove'], 'elevated_pin');
eq('кассир: возврат — PIN старшего', c['order.refund'], 'elevated_pin');
eq('официант: отмена запрещена', ROLE_PRESETS.WAITER.permissions['order.cancel'], 'denied');
// безопасное умолчание
eq('не указанное право = denied', resolvePermission({}, 'order.refund'), 'denied');
eq('владелец: всё allowed', resolvePermission(ROLE_PRESETS.OWNER.permissions,'admin.billing'), 'allowed');
eq('denied не разрешено', isAllowed('denied'), false);
eq('elevated_pin — разрешено (но с подтверждением)', isAllowed('elevated_pin'), true);
// требование PIN
eq('self_pin → свой', pinRequirement('self_pin'), {who:'self', title:'Подтвердите своим PIN'});
eq('elevated_pin → старший', pinRequirement('elevated_pin')?.who, 'elevated');
eq('allowed → PIN не нужен', pinRequirement('allowed'), null);
// иерархия
eq('менеджер подтверждает за кассира', canElevate('CASHIER','MANAGER'), true);
eq('кассир НЕ подтверждает за кассира', canElevate('CASHIER','CASHIER'), false);
eq('официант не подтверждает за кассира', canElevate('CASHIER','WAITER'), false);
eq('владелец подтверждает за всех', canElevate('MANAGER','OWNER'), true);
// решение для UI
eq('checkAction: скрыть', checkAction(ROLE_PRESETS.WAITER.permissions,'order.refund').effect, 'hide');
eq('checkAction: спросить старшего', checkAction(c,'order.item.remove').effect, 'ask_elevated_pin');
eq('checkAction: спросить свой', checkAction(c,'cash.shift.close').effect, 'ask_self_pin');
eq('checkAction: выполнить', checkAction(c,'order.create').effect, 'run');

console.log('── ЧАЕВЫЕ ──');
eq('Айгерим → aigerim', tipSlug('Айгерим Нурлановна'), 'aigerim');
eq('казахские буквы: Әйгерім → aigerim', tipSlug('Әйгерім'), 'aigerim');
eq('Ербол → erbol', tipSlug('Ербол Смагулов'), 'erbol');
eq('Жанна → zhanna', tipSlug('Жанна'), 'zhanna');
eq('дубль → aigerim2', uniqueTipSlug('Айгерим', ['aigerim']), 'aigerim2');
eq('третья → aigerim3', uniqueTipSlug('Айгерим', ['aigerim','aigerim2']), 'aigerim3');
eq('ссылка', tipLink('aigerim'), 'https://dstrh.kz/tip/aigerim');
eq('QR на чеке с заказом', tipQrPayload('aigerim','o42'), 'https://dstrh.kz/tip/aigerim?o=o42');
// налоговый эффект
eq('QR не идёт через заведение', goesThroughBusiness('qr_direct'), false);
eq('через чек — идёт', goesThroughBusiness('via_check'), true);
const noteQr = tipMethodNote('qr_direct', 10_000_000);
eq('QR: налога нет', [noteQr.tone, noteQr.extraTax], ['ok', 0]);
const noteCheck = tipMethodNote('via_check', 10_000_000, 3);
eq('через кассу: 3% с 100 000 = 3 000 ₸', noteCheck.extraTax, 300000);
eq('через кассу: предупреждение', noteCheck.tone, 'warn');
eq('текст называет сумму налога', noteCheck.text.includes('3 000 ₸'), true);
// сводка
const D=(d:number)=>new Date(2026,6,d);
const tips: TipRecord[] = [
  {id:'1', employeeId:'e1', method:'qr_direct', amount:200000, at:D(5), locationId:'l1'},
  {id:'2', employeeId:'e1', method:'qr_direct', amount:300000, at:D(6), locationId:'l1'},
  {id:'3', employeeId:'e1', method:'via_check', amount:100000, at:D(7), locationId:'l1'},
  {id:'4', employeeId:'e2', method:'cash', amount:500000, at:D(7), locationId:'l1'},
];
const s = tipsSummary(tips,'e1',D(1),D(31));
eq('Айгерим: всего 6000, из них QR 5000', [s.total, s.byQr, s.viaCheck], [600000, 500000, 100000]);
eq('средний чаевой 2000', s.avgTip, 200000);
eq('чужие не считаются', s.count, 3);
// выручка без чаевых
const rev = revenueWithoutTips(50_000_000, tips);
eq('из выручки вычтено только «через кассу»', rev, {revenue: 50_000_000-100000, tipsThroughBusiness: 100000});
// дележ
const pool = splitTipPool(100000, [
  {employeeId:'a',name:'А',hours:8},{employeeId:'b',name:'Б',hours:4}], 'by_hours');
eq('по часам 8:4 → 667/333', pool.map(p=>p.amount), [66667, 33333]);
eq('тиыны не теряются', pool.reduce((x,p)=>x+p.amount,0), 100000);
const eqPool = splitTipPool(100001, [{employeeId:'a',name:'А',hours:1},{employeeId:'b',name:'Б',hours:1},{employeeId:'c',name:'В',hours:1}], 'equal');
eq('поровну с остатком: сумма сходится', eqPool.reduce((x,p)=>x+p.amount,0), 100001);
eq('остаток первому', eqPool[0].amount, 33335);
eq('нулевые часы → поровну', splitTipPool(90000,[{employeeId:'a',name:'А',hours:0},{employeeId:'b',name:'Б',hours:0}],'by_hours').map(p=>p.amount), [45000,45000]);

console.log('── МЕТРИКИ ВЕНДОРА ──');
const A=(o:Partial<AccountMetric>):AccountMetric=>({accountId:'a',name:'X',status:'ACTIVE',mrr:1800000,
  startedAt:D(1),source:'self',...o});
const accounts: AccountMetric[] = [
  A({accountId:'1', mrr:1800000, status:'ACTIVE', source:'self', startedAt:D(3), firstReceiptAt:D(3)}),
  A({accountId:'2', mrr:1200000, status:'ACTIVE', source:'dealer', startedAt:D(5), firstReceiptAt:D(6)}),
  A({accountId:'3', mrr:2600000, status:'PAST_DUE', source:'self', startedAt:D(8), firstReceiptAt:D(9)}),
  A({accountId:'4', mrr:1800000, status:'TRIAL', source:'dealer', startedAt:D(10), firstReceiptAt:null}),
  A({accountId:'5', mrr:1800000, status:'CANCELLED', source:'self', startedAt:D(2)}),
  // активировался (пробил чек), но ещё на пробном — проверяет разницу метрик
  A({accountId:'6', mrr:1800000, status:'TRIAL', source:'self', startedAt:D(12), firstReceiptAt:D(12)}),
];
eq('MRR: активные + просроченные', mrr(accounts), 1800000+1200000+2600000);
eq('ARR = MRR×12', arr(accounts), (1800000+1200000+2600000)*12);
eq('ARPA', arpa(accounts), Math.round((1800000+1200000+2600000)/3));
eq('отток 2 из 80 = 2.5%', churnPct(80,2), 2.5);
eq('деление на ноль', churnPct(0,5), 0);
const src = newBySource(accounts, D(1), D(31));
eq('новые: 4 сами, 2 через дилеров', [src.total, src.self, src.dealer], [6,4,2]);
// активация
const conv = trialConversion(accounts);
eq('дошли до первого чека 4 из 6 = 67%', [conv.reachedFirstReceipt, conv.toReceiptPct], [4, 67]);
eq('заплатили 3 из 6 = 50%', [conv.paid, conv.toPaidPct], [3, 50]);
// ключевая метрика: активация почти гарантирует оплату (3 из 4 = 75%)
eq('из дошедших до чека заплатили 75%', conv.paidAmongActivatedPct, 75);
eq('медиана времени до чека', medianTimeToFirstReceiptHours([
  A({startedAt:new Date(2026,6,1,10), firstReceiptAt:new Date(2026,6,1,12)}),
  A({startedAt:new Date(2026,6,1,10), firstReceiptAt:new Date(2026,6,1,14)}),
  A({startedAt:new Date(2026,6,1,10), firstReceiptAt:new Date(2026,6,1,16)}),
]), 4);
eq('нет активаций → null', medianTimeToFirstReceiptHours([A({firstReceiptAt:null})]), null);

console.log('── ЗДОРОВЬЕ КЛИЕНТОВ ──');
const now = new Date(2026,6,19,14,0);
const T=(o:Partial<AccountTelemetry>):AccountTelemetry=>({accountId:'t',name:'Кафе',mrr:1800000,
  lastTerminalSeenAt:new Date(2026,6,19,13,0), receiptsLast7d:100,
  revenueThisMonth:10_000_000, revenuePrevMonth:10_000_000, lastContactAt:D(1), status:'ACTIVE',...o});
eq('касса молчит 30ч → critical', assessRisk(T({lastTerminalSeenAt:new Date(2026,6,18,7,0)}), now).level, 'critical');
eq('касса не выходила ни разу → critical', assessRisk(T({lastTerminalSeenAt:null}), now).reason, 'Касса не в сети');
eq('касса в сети, но 0 чеков → high', assessRisk(T({receiptsLast7d:0}), now).level, 'high');
eq('выручка −40% → medium', assessRisk(T({revenueThisMonth:6_000_000}), now).level, 'medium');
eq('выручка −20% → ok', assessRisk(T({revenueThisMonth:8_000_000}), now).level, 'ok');
eq('всё хорошо → ok', assessRisk(T({}), now).level, 'ok');
eq('приоритет: молчащая касса важнее нулевых чеков',
  assessRisk(T({lastTerminalSeenAt:new Date(2026,6,17), receiptsLast7d:0}), now).level, 'critical');
// сводка в деньгах
const rows = [
  assessRisk(T({accountId:'1', name:'Дастархан', mrr:1800000, lastTerminalSeenAt:new Date(2026,6,17)}), now),
  assessRisk(T({accountId:'2', name:'Донер', mrr:1200000, receiptsLast7d:0}), now),
  assessRisk(T({accountId:'3', name:'Кофейня', mrr:2600000, revenueThisMonth:5_000_000}), now),
  assessRisk(T({accountId:'4', name:'Здоровый', mrr:5000000}), now),
];
const hs = healthSummary(rows, 20_000_000);
eq('на обзвон 3', hs.callsToday, 3);
eq('MRR под риском 56 000', hs.mrrAtRisk, 1800000+1200000+2600000);
eq('доля от MRR 28%', hs.shareOfMrrPct, 28);
eq('разбивка по уровням', hs.byLevel, {critical:1, high:1, medium:1});
// очередь обзвона
const q = callQueue(rows);
eq('здоровый в очередь не попал', q.length, 3);
eq('первым — critical', q[0].name, 'Дастархан');
eq('дальше high, потом medium', [q[1].name, q[2].name], ['Донер','Кофейня']);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

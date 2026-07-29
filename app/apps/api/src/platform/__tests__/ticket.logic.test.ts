import { SLA, INCIDENT_SLA, reactionDueAt, resolveDueAt, overdueReaction, overdueResolve,
  minutesToDeadline, slaTone, sortQueue, shouldEscalate, escalate, normalizeSubject,
  subjectSimilarity, detectMassIncident, linkToIncident, supportStats } from '../../../../../packages/shared/src/platform/ticket.logic.ts';
import type { Ticket } from '../../../../../packages/shared/src/platform/ticket.logic.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)}`))};
const at=(h:number,m=0)=>new Date(2026,6,27,h,m);
const T = (p: Partial<Ticket>): Ticket => ({
  id:'t1', accountId:'a1', accountName:'Кафе', accountMrr:18_000_00,
  subject:'Не печатает чек', priority:'normal', status:'NEW', level:'VENDOR',
  createdAt:at(10), ...p });

// ═══ ДВА СРОКА SLA (модель r_keeper) ═══
eq('critical: реакция 30 мин', reactionDueAt(T({priority:'critical'})).getTime(), at(10,30).getTime());
eq('critical: решение 4 часа', resolveDueAt(T({priority:'critical'})).getTime(), at(14).getTime());
eq('normal: реакция 4 ч', reactionDueAt(T({priority:'normal'})).getTime(), at(14).getTime());
eq('normal: решение 24 ч', resolveDueAt(T({priority:'normal'})).getTime(), new Date(2026,6,28,10).getTime());
eq('инцидент: свой регламент 30мин/4ч', [reactionDueAt(T({isIncident:true,priority:'low'})).getTime(),
   resolveDueAt(T({isIncident:true,priority:'low'})).getTime()], [at(10,30).getTime(), at(14).getTime()]);

// просрочки раздельные
eq('реакции нет, 5 ч прошло → просрочка реакции', overdueReaction(T({}), at(15)), true);
eq('ответили → просрочки реакции нет', overdueReaction(T({firstResponseAt:at(11)}), at(15)), false);
eq('решение: 25 ч → просрочка', overdueResolve(T({firstResponseAt:at(11)}), new Date(2026,6,28,11)), true);
eq('решённый не просрочен', overdueResolve(T({status:'RESOLVED'}), new Date(2027,0,1)), false);

// таймер показывает ближайший дедлайн
eq('пока нет ответа — считаем до реакции', minutesToDeadline(T({}), at(12)), {minutes:120, kind:'reaction'});
eq('после ответа — до решения', minutesToDeadline(T({firstResponseAt:at(11)}), at(12)), {minutes:22*60, kind:'resolve'});
eq('просрочка = минус', minutesToDeadline(T({}), at(15)).minutes, -60);

// цвет
eq('запас — ok', slaTone(T({}), at(10,30)), 'ok');
eq('осталось 25% — soon', slaTone(T({}), at(13,15)), 'soon');
eq('просрочено — late', slaTone(T({}), at(15)), 'late');
eq('закрытый всегда ok', slaTone(T({status:'CLOSED'}), at(23)), 'ok');

// ═══ ОЧЕРЕДЬ: просроченные вперёд, при равенстве — дороже MRR ═══
const q = sortQueue([
  T({id:'ok', createdAt:at(12), priority:'low', accountMrr:10_000_00}),
  T({id:'late-cheap', createdAt:at(8), priority:'critical', accountMrr:12_000_00}),
  T({id:'late-rich', createdAt:at(8), priority:'critical', accountMrr:54_000_00}),
  T({id:'closed', status:'CLOSED'}),
], at(13));
eq('закрытые не в очереди', q.find(t=>t.id==='closed'), undefined);
eq('просроченные первыми', q[0].id.startsWith('late'), true);
eq('при равной срочности — дороже MRR вперёд', [q[0].id, q[1].id], ['late-rich','late-cheap']);

// ═══ ЭСКАЛАЦИЯ ═══
eq('дилер просрочил → эскалация', shouldEscalate(T({level:'DEALER'}), at(15)), true);
eq('вендор не эскалируется', shouldEscalate(T({level:'VENDOR'}), at(15)), false);
eq('в срок — не эскалируется', shouldEscalate(T({level:'DEALER'}), at(11)), false);
let threw=false; try { escalate(T({level:'DEALER'}), '  ') } catch { threw=true }
eq('эскалация без причины запрещена', threw, true);
eq('с причиной — уходит вендору', escalate(T({level:'DEALER'}), 'нет ответа 6ч').level, 'VENDOR');

// ═══ АВТОДЕТЕКТ МАССОВОГО ИНЦИДЕНТА (наша добавка) ═══
eq('нормализация темы', normalizeSubject('Не ПЕЧАТАЕТ  чек!!! (ё)'), 'не печатает чек е');
eq('похожие темы', subjectSimilarity('Webkassa не отвечает','Не отвечает Webkassa') >= 0.5, true);
eq('разные темы', subjectSimilarity('Не печатает чек','Не могу войти в бэк-офис') < 0.5, true);

const mass = detectMassIncident([
  T({id:'m1', accountId:'a1', accountMrr:18_000_00, subject:'Webkassa не отвечает ошибка', createdAt:at(12,10)}),
  T({id:'m2', accountId:'a2', accountMrr:12_000_00, subject:'Ошибка Webkassa не отвечает', createdAt:at(12,20)}),
  T({id:'m3', accountId:'a3', accountMrr:26_000_00, subject:'не отвечает Webkassa ошибка чек', createdAt:at(12,25)}),
  T({id:'other', accountId:'a4', subject:'Как настроить принтер этикеток', createdAt:at(12,15)}),
], at(12,30));
eq('инцидент найден', mass.length, 1);
eq('3 аккаунта затронуто', mass[0].accountsAffected, 3);
eq('MRR под ударом 56 000', mass[0].mrrAffected, 56_000_00);
eq('посторонний тикет не втянут', mass[0].ticketIds.includes('other'), false);

// два тикета от ОДНОГО аккаунта — не инцидент
eq('дубли одного клиента ≠ инцидент', detectMassIncident([
  T({id:'x1', accountId:'a1', subject:'Webkassa не отвечает', createdAt:at(12,10)}),
  T({id:'x2', accountId:'a1', subject:'Webkassa не отвечает опять', createdAt:at(12,15)}),
  T({id:'x3', accountId:'a1', subject:'Webkassa не отвечает снова', createdAt:at(12,20)}),
], at(12,30)).length, 0);
// старые тикеты вне окна
eq('вне окна часа не считается', detectMassIncident([
  T({id:'o1', accountId:'a1', subject:'Webkassa не отвечает', createdAt:at(8)}),
  T({id:'o2', accountId:'a2', subject:'Webkassa не отвечает', createdAt:at(8,10)}),
  T({id:'o3', accountId:'a3', subject:'Webkassa не отвечает', createdAt:at(8,20)}),
], at(12,30)).length, 0);

// привязка
const linked = linkToIncident([T({id:'m1'}), T({id:'m2'})], ['m1'], 'INC-1');
eq('привязан только выбранный', [linked[0].incidentId, linked[1].incidentId ?? null], ['INC-1', null]);

// ═══ МЕТРИКИ ПОДДЕРЖКИ ═══
const st = supportStats([
  T({id:'s1', status:'NEW', createdAt:at(8), accountMrr:18_000_00}),
  T({id:'s2', status:'IN_PROGRESS', createdAt:at(12), firstResponseAt:at(12,30), assignee:'Асель', accountMrr:12_000_00}),
  T({id:'s3', status:'RESOLVED', createdAt:at(9), firstResponseAt:at(9,20), resolvedAt:at(10), csat:5}),
  T({id:'s4', status:'CLOSED', createdAt:at(6), firstResponseAt:at(6,40), resolvedAt:new Date(2026,6,28,12), csat:3}),
], at(13));
eq('открытых 2', st.open, 2);
eq('просрочен 1 (s1 без ответа с 8:00)', st.overdue, 1);
eq('без исполнителя 1', st.unassigned, 1);
eq('средняя реакция 30 мин', st.avgReactionMin, 30);
eq('SLA соблюдён 50% (s4 решён позже срока)', st.slaKeptPct, 50);
eq('CSAT 4.0', st.csat, 4);
eq('MRR под ударом 30 000', st.mrrAtStake, 30_000_00);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

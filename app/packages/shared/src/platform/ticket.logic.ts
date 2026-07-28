// apps/api/src/platform/ticket.logic.ts
// SERVICE DESK — очередь поддержки вендора.
// Анализ r_keeper Service Desk (эталон рынка): ДВА регламентных срока —
// «время реакции» (когда обязаны ответить) и «время решения» (когда обязаны
// закрыть), с раздельными признаками просрочки; статусная модель; эскалация
// «только по причинам»; оценка качества после решения; отдельный тип
// «массовый инцидент» с авто-уведомлением затронутых.
//
// НАШИ ПРОФИ-ДОБАВКИ СВЕРХ r_keeper:
//  1) АВТОДЕТЕКТ массового инцидента: если за час пришло N+ похожих обращений,
//     система сама предлагает объединить их в инцидент. У r_keeper инцидент
//     заводит дилер руками — а значит первые полчаса все отвечают поодиночке.
//  2) Приоритет очереди считается из СРОЧНОСТИ ПО ОБОИМ таймерам сразу,
//     а не по одному полю: наверх всплывает то, что горит раньше.
//  3) Влияние в деньгах: рядом с тикетом видно MRR аккаунта — при равной
//     срочности сначала берём того, чей уход дороже.

export type Money = number;

export type TicketPriority = 'low' | 'normal' | 'high' | 'critical';
export type TicketStatus = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_CLIENT' | 'RESOLVED' | 'CLOSED';
export type TicketLevel = 'DEALER' | 'VENDOR';

/** Регламент в часах: [реакция, решение] — модель r_keeper. */
export const SLA: Record<TicketPriority, { reactionH: number; resolveH: number }> = {
  critical: { reactionH: 0.5, resolveH: 4 },   // касса не работает, точка стоит
  high:     { reactionH: 2,   resolveH: 8 },
  normal:   { reactionH: 4,   resolveH: 24 },
  low:      { reactionH: 8,   resolveH: 48 },
};

/** Массовый инцидент: свой регламент (r_keeper — 4 часа на решение). */
export const INCIDENT_SLA = { reactionH: 0.5, resolveH: 4 };

export interface Ticket {
  id: string;
  accountId: string;
  accountName: string;
  accountMrr: Money;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  level: TicketLevel;
  createdAt: Date;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  assignee?: string | null;
  incidentId?: string | null;   // привязка к массовому инциденту
  isIncident?: boolean;         // сам тикет — родительский инцидент
  csat?: number | null;         // оценка качества 1..5 (r_keeper)
  escalationReason?: string | null;
}

// ═══════════════ СРОКИ ═══════════════

export function reactionDueAt(t: Pick<Ticket, 'createdAt' | 'priority' | 'isIncident'>): Date {
  const h = t.isIncident ? INCIDENT_SLA.reactionH : SLA[t.priority].reactionH;
  return new Date(+t.createdAt + h * 3600_000);
}

export function resolveDueAt(t: Pick<Ticket, 'createdAt' | 'priority' | 'isIncident'>): Date {
  const h = t.isIncident ? INCIDENT_SLA.resolveH : SLA[t.priority].resolveH;
  return new Date(+t.createdAt + h * 3600_000);
}

/** Просрочка по реакции: ответа ещё нет и регламент прошёл. */
export function overdueReaction(t: Ticket, now: Date): boolean {
  if (t.firstResponseAt) return false;
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
  return now > reactionDueAt(t);
}

/** Просрочка по решению: не решён и регламент прошёл. */
export function overdueResolve(t: Ticket, now: Date): boolean {
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
  return now > resolveDueAt(t);
}

/** Сколько минут осталось до ближайшего дедлайна (минус = просрочено). */
export function minutesToDeadline(t: Ticket, now: Date): { minutes: number; kind: 'reaction' | 'resolve' } {
  const needReaction = !t.firstResponseAt;
  const target = needReaction ? reactionDueAt(t) : resolveDueAt(t);
  return {
    minutes: Math.round((+target - +now) / 60000),
    kind: needReaction ? 'reaction' : 'resolve',
  };
}

export type SlaTone = 'ok' | 'soon' | 'late';

/** Цвет таймера: горит с 25% остатка (не в последнюю минуту). */
export function slaTone(t: Ticket, now: Date): SlaTone {
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return 'ok';
  const { minutes, kind } = minutesToDeadline(t, now);
  if (minutes < 0) return 'late';
  const totalH = t.isIncident
    ? (kind === 'reaction' ? INCIDENT_SLA.reactionH : INCIDENT_SLA.resolveH)
    : (kind === 'reaction' ? SLA[t.priority].reactionH : SLA[t.priority].resolveH);
  return minutes <= totalH * 60 * 0.25 ? 'soon' : 'ok';
}

// ═══════════════ ОЧЕРЕДЬ ═══════════════

/** Вес срочности: чем меньше — тем выше в очереди.
 *  Наша добавка: при равной срочности вперёд идёт дороже MRR. */
export function queueRank(t: Ticket, now: Date): { late: number; minutes: number; mrr: number } {
  const tone = slaTone(t, now);
  const { minutes } = minutesToDeadline(t, now);
  return {
    late: tone === 'late' ? 0 : tone === 'soon' ? 1 : 2,
    minutes,
    mrr: -t.accountMrr,
  };
}

export function sortQueue(tickets: Ticket[], now: Date): Ticket[] {
  const open = tickets.filter((t) => t.status !== 'CLOSED' && t.status !== 'RESOLVED');
  return [...open].sort((a, b) => {
    const ra = queueRank(a, now), rb = queueRank(b, now);
    return ra.late - rb.late || ra.minutes - rb.minutes || ra.mrr - rb.mrr;
  });
}

/** Эскалация с 1-й линии (дилер) на вендора — по просрочке любого из сроков. */
export function shouldEscalate(t: Ticket, now: Date): boolean {
  if (t.level !== 'DEALER') return false;
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
  return overdueReaction(t, now) || overdueResolve(t, now);
}

export function escalate(t: Ticket, reason: string): Ticket {
  if (!reason?.trim()) throw new Error('ESCALATION_REASON_REQUIRED'); // r_keeper: только по причинам
  return { ...t, level: 'VENDOR', escalationReason: reason.trim() };
}

// ═══════════════ МАССОВЫЕ ИНЦИДЕНТЫ ═══════════════

/** Нормализация темы для сравнения: регистр, ё, лишние пробелы, знаки. */
export function normalizeSubject(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Похожесть тем по общим словам (Жаккар), длинные слова весомее. */
export function subjectSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeSubject(a).split(' ').filter((w) => w.length >= 4));
  const wb = new Set(normalizeSubject(b).split(' ').filter((w) => w.length >= 4));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return +(inter / (wa.size + wb.size - inter)).toFixed(2);
}

export interface IncidentSuggestion {
  subject: string;
  ticketIds: string[];
  accountsAffected: number;
  mrrAffected: Money;
}

/**
 * АВТОДЕТЕКТ массового инцидента (нет ни у одного конкурента).
 * Если за окно windowMin пришло minCount+ обращений с похожими темами
 * от РАЗНЫХ аккаунтов — предлагаем объединить в инцидент.
 */
export function detectMassIncident(
  tickets: Ticket[], now: Date,
  { windowMin = 60, minCount = 3, minSimilarity = 0.5 } = {},
): IncidentSuggestion[] {
  const fresh = tickets.filter((t) =>
    !t.incidentId && !t.isIncident
    && t.status !== 'CLOSED' && t.status !== 'RESOLVED'
    && (+now - +t.createdAt) <= windowMin * 60_000);

  const used = new Set<string>();
  const out: IncidentSuggestion[] = [];

  for (const seed of fresh) {
    if (used.has(seed.id)) continue;
    const group = [seed];
    for (const other of fresh) {
      if (other.id === seed.id || used.has(other.id)) continue;
      if (subjectSimilarity(seed.subject, other.subject) >= minSimilarity) group.push(other);
    }
    const accounts = new Set(group.map((t) => t.accountId));
    if (group.length >= minCount && accounts.size >= minCount) {
      group.forEach((t) => used.add(t.id));
      out.push({
        subject: seed.subject,
        ticketIds: group.map((t) => t.id),
        accountsAffected: accounts.size,
        mrrAffected: [...accounts].reduce((s, id) => {
          const t = group.find((x) => x.accountId === id)!;
          return s + t.accountMrr;
        }, 0),
      });
    }
  }
  return out.sort((a, b) => b.accountsAffected - a.accountsAffected);
}

/** Привязка тикетов к инциденту: ответ один — уходит всем (r_keeper). */
export function linkToIncident(tickets: Ticket[], ids: string[], incidentId: string): Ticket[] {
  return tickets.map((t) => (ids.includes(t.id) ? { ...t, incidentId } : t));
}

// ═══════════════ МЕТРИКИ ПОДДЕРЖКИ ═══════════════

export function supportStats(tickets: Ticket[], now: Date) {
  const open = tickets.filter((t) => t.status !== 'CLOSED' && t.status !== 'RESOLVED');
  const resolved = tickets.filter((t) => t.resolvedAt);
  const withCsat = tickets.filter((t) => typeof t.csat === 'number');
  const reactionTimes = tickets
    .filter((t) => t.firstResponseAt)
    .map((t) => (+t.firstResponseAt! - +t.createdAt) / 60000);

  return {
    open: open.length,
    overdue: open.filter((t) => overdueReaction(t, now) || overdueResolve(t, now)).length,
    unassigned: open.filter((t) => !t.assignee).length,
    avgReactionMin: reactionTimes.length
      ? Math.round(reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length) : null,
    slaKeptPct: resolved.length
      ? Math.round(100 * resolved.filter((t) => t.resolvedAt! <= resolveDueAt(t)).length / resolved.length) : null,
    csat: withCsat.length
      ? +(withCsat.reduce((s, t) => s + (t.csat ?? 0), 0) / withCsat.length).toFixed(1) : null,
    mrrAtStake: open.reduce((s, t) => s + t.accountMrr, 0),
  };
}

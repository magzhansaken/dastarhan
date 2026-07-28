// apps/vendor/src/VendorShell.tsx
// Оболочка супер-админки + Service Desk + матрица тарифов.
// Макет: Claude Design «Супер-админка вендора» и «Админка — Клиент, биллинг,
// тикеты, тарифы». Боковое меню со счётчиками, как в макете.
import React, { useMemo, useState } from 'react';
import {
  Ticket, sortQueue, slaTone, minutesToDeadline, overdueReaction, overdueResolve,
  detectMassIncident, supportStats, shouldEscalate, SLA,
} from '../../../packages/shared/src/platform/ticket.logic';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

/** «через 2 ч 15 мин» / «просрочено на 40 мин» */
export function slaLabel(min: number): string {
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60), m = abs % 60;
  const body = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  return min < 0 ? `просрочено на ${body}` : `через ${body}`;
}

export const PRIORITY_RU: Record<Ticket['priority'], string> = {
  critical: 'Критично', high: 'Высокий', normal: 'Обычный', low: 'Низкий',
};
export const STATUS_RU: Record<Ticket['status'], string> = {
  NEW: 'Новое', ASSIGNED: 'Назначено', IN_PROGRESS: 'В работе',
  WAITING_CLIENT: 'Ждём клиента', RESOLVED: 'Решено', CLOSED: 'Закрыто',
};

// ═══════════════ ОБОЛОЧКА С НАВИГАЦИЕЙ ═══════════════

export interface NavCounts {
  accounts: number; health: number; tickets: number; dunning: number; dealers: number;
}

export function VendorShell(props: {
  active: string;
  counts: NavCounts;
  user: { name: string; role: string };
  children: React.ReactNode;
  onNav: (key: string) => void;
}) {
  const items = [
    { key: 'pulse', name: 'Пульс' },
    { key: 'accounts', name: 'Аккаунты', count: props.counts.accounts },
    { key: 'health', name: 'Здоровье клиентов', count: props.counts.health, hot: props.counts.health > 0 },
    { key: 'billing', name: 'Биллинг', count: props.counts.dunning, hot: props.counts.dunning > 0 },
    { key: 'tickets', name: 'Тикеты', count: props.counts.tickets, hot: props.counts.tickets > 0 },
    { key: 'dealers', name: 'Дилеры', count: props.counts.dealers },
    { key: 'features', name: 'Тарифы и функции' },
  ];
  return (
    <div className="vendor-layout">
      <aside className="vendor-nav">
        <div className="bo-logo">Dastarhan <span className="vendor-badge">Вендор</span></div>
        {items.map((i) => (
          <button key={i.key}
            className={`nav-item ${props.active === i.key ? 'on' : ''}`}
            onClick={() => props.onNav(i.key)}>
            <span>{i.name}</span>
            {i.count !== undefined && (
              <span className={`nav-count ${i.hot ? 'nav-hot' : ''}`}>{i.count}</span>
            )}
          </button>
        ))}
        <div className="vendor-user">
          <b>{props.user.name}</b>
          <span>{props.user.role}</span>
        </div>
      </aside>
      <main>{props.children}</main>
    </div>
  );
}

// ═══════════════ SERVICE DESK ═══════════════

export function TicketsScreen(props: {
  tickets: Ticket[];
  now: Date;
  onOpen: (id: string) => void;
  onCreateIncident: (ticketIds: string[], subject: string) => void;
  onEscalate: (id: string) => void;
}) {
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);

  const stats = useMemo(() => supportStats(props.tickets, props.now), [props.tickets, props.now]);
  const incidents = useMemo(() => detectMassIncident(props.tickets, props.now), [props.tickets, props.now]);
  const queue = useMemo(() => {
    let q = sortQueue(props.tickets, props.now);
    if (onlyOverdue) q = q.filter((t) => overdueReaction(t, props.now) || overdueResolve(t, props.now));
    if (onlyMine) q = q.filter((t) => !!t.assignee);
    return q;
  }, [props.tickets, props.now, onlyOverdue, onlyMine]);

  return (
    <div className="tickets-screen">
      <header className="doc-head">
        <div>
          <h2>Тикеты</h2>
          <p className="health-sub">
            Очередь отсортирована по срочности: сначала просроченное, при равном сроке — клиент дороже.
          </p>
        </div>
      </header>

      {/* автодетект массового инцидента — наша добавка */}
      {incidents.map((inc, i) => (
        <div key={i} className="incident-alert">
          <div>
            <b>Похоже на массовый инцидент</b>
            <p>
              {inc.accountsAffected} клиента пишут об одном и том же: «{inc.subject}».
              Под ударом {fmt(inc.mrrAffected)} MRR. Ответ на инцидент уйдёт всем сразу.
            </p>
          </div>
          <button className="btn btn-accent"
            onClick={() => props.onCreateIncident(inc.ticketIds, inc.subject)}>
            Объединить в инцидент
          </button>
        </div>
      ))}

      <div className="ticket-kpis">
        <div className="kpi"><span>Открытых</span><b>{stats.open}</b></div>
        <div className="kpi"><span>Просрочено</span>
          <b className={stats.overdue ? 'kpi-bad' : ''}>{stats.overdue}</b></div>
        <div className="kpi"><span>Без исполнителя</span><b>{stats.unassigned}</b></div>
        <div className="kpi"><span>Средняя реакция</span>
          <b>{stats.avgReactionMin != null ? `${stats.avgReactionMin} мин` : '—'}</b></div>
        <div className="kpi"><span>SLA соблюдён</span>
          <b>{stats.slaKeptPct != null ? `${stats.slaKeptPct}%` : '—'}</b></div>
        <div className="kpi"><span>Оценка клиентов</span>
          <b>{stats.csat != null ? `${stats.csat} / 5` : '—'}</b></div>
      </div>

      <div className="filters">
        <label><input type="checkbox" checked={onlyOverdue}
          onChange={() => setOnlyOverdue(!onlyOverdue)} /> Только просроченные</label>
        <label><input type="checkbox" checked={onlyMine}
          onChange={() => setOnlyMine(!onlyMine)} /> Только назначенные</label>
        <span className="ml-auto adm-hint">MRR в очереди: <b>{fmt(stats.mrrAtStake)}</b></span>
      </div>

      <table className="doc-table">
        <thead><tr>
          <th>Тема</th><th>Клиент</th><th>Приоритет</th><th>Статус</th><th>Срок</th><th></th>
        </tr></thead>
        <tbody>
          {queue.map((t) => {
            const tone = slaTone(t, props.now);
            const { minutes, kind } = minutesToDeadline(t, props.now);
            return (
              <tr key={t.id} className={tone === 'late' ? 'row-warn' : ''}>
                <td>
                  <button className="link-cell" onClick={() => props.onOpen(t.id)}>{t.subject}</button>
                  {t.incidentId && <span className="inc-badge">инцидент</span>}
                  {t.isIncident && <span className="inc-badge inc-parent">массовый</span>}
                  {t.level === 'DEALER' && <span className="lock-badge">1-я линия</span>}
                </td>
                <td>{t.accountName}<span className="adm-city">{fmt(t.accountMrr)}/мес</span></td>
                <td><span className={`prio prio-${t.priority}`}>{PRIORITY_RU[t.priority]}</span></td>
                <td>{STATUS_RU[t.status]}{t.assignee && <span className="adm-city">{t.assignee}</span>}</td>
                <td>
                  <span className={`sla-timer sla-${tone}`}>{slaLabel(minutes)}</span>
                  <span className="adm-city">{kind === 'reaction' ? 'до ответа' : 'до решения'}</span>
                </td>
                <td className="adm-r">
                  {shouldEscalate(t, props.now) && (
                    <button className="btn btn-sm btn-danger" onClick={() => props.onEscalate(t.id)}>
                      Эскалировать
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {queue.length === 0 && (
        <div className="state-empty">
          <b>Все обращения закрыты 👌</b>
          <span>Ни одного открытого тикета — редкий и хороший день.</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════ МАТРИЦА ТАРИФ × ФУНКЦИЯ ═══════════════

export function FeatureMatrix(props: {
  planKeys: string[];
  planNames: Record<string, string>;
  features: { key: string; title: string; group: string }[];
  matrix: Record<string, string[]>;      // planKey → список функций
  clientsPerPlan: Record<string, number>;
  onToggle: (planKey: string, feature: string) => void;
  dirty: boolean;
  onSave: () => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, typeof props.features>();
    for (const f of props.features) {
      if (!m.has(f.group)) m.set(f.group, []);
      m.get(f.group)!.push(f);
    }
    return [...m.entries()];
  }, [props.features]);

  return (
    <div className="feature-matrix">
      <header className="doc-head">
        <div>
          <h2>Тарифы и функции</h2>
          <p className="health-sub">Состав тарифов меняется здесь — без релиза приложения.</p>
        </div>
        <button className="btn btn-accent" disabled={!props.dirty} onClick={props.onSave}>
          Сохранить состав
        </button>
      </header>

      <table className="doc-table matrix">
        <thead>
          <tr>
            <th>Возможность</th>
            {props.planKeys.map((k) => (
              <th key={k}>
                {props.planNames[k]}
                <span className="adm-city">{props.clientsPerPlan[k] ?? 0} клиентов</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, items]) => (
            <React.Fragment key={group}>
              <tr><td colSpan={props.planKeys.length + 1} className="perm-group-title">{group}</td></tr>
              {items.map((f) => (
                <tr key={f.key}>
                  <td>{f.title}</td>
                  {props.planKeys.map((k) => {
                    const on = (props.matrix[k] ?? []).includes(f.key);
                    return (
                      <td key={k}>
                        <button className={`matrix-cell ${on ? 'matrix-on' : 'matrix-off'}`}
                          onClick={() => props.onToggle(k, f.key)}
                          aria-label={`${props.planNames[k]} · ${f.title}`}>
                          {on ? '✓' : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <p className="hint">
        Снятие галочки у действующего тарифа отключит возможность у клиентов при следующем входе —
        предупредите их заранее.
      </p>
    </div>
  );
}

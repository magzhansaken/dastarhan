// apps/vendor/src/VendorScreens.tsx
// СУПЕР-АДМИНКА ВЕНДОРА — приложения не существовало, логика метрик готова.
// Анализ: r_keeper License — вендорский портал считает ЛИЦЕНЗИИ и договоры,
// но не показывает деньги под риском; Paloma — счета постфактум; Poster —
// self-serve без вендорской аналитики.
// Наш экран «Здоровье клиентов» переводит отток в деньги: не «14 проблемных
// аккаунтов», а «486 000 ₸ MRR уйдёт, если сегодня не позвонить».
import React, { useMemo, useState } from 'react';
import {
  mrr, arr, arpa, churnPct, newBySource, trialConversion,
  assessRisk, healthSummary, callQueue,
} from '../../api/src/platform/vendor.metrics';
import type { AccountMetric, AccountTelemetry, RiskRow, RiskLevel } from '../../api/src/platform/vendor.metrics';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ ПУЛЬС ═══════════════

export function VendorPulse(props: {
  accounts: AccountMetric[];
  period: { from: Date; to: Date };
  churnedThisPeriod: number;
  accountsAtStart: number;
  mrrPrevMonth: number;
}) {
  const currentMrr = mrr(props.accounts);
  const growthPct = props.mrrPrevMonth > 0
    ? +((100 * (currentMrr - props.mrrPrevMonth)) / props.mrrPrevMonth).toFixed(1)
    : null;
  const src = newBySource(props.accounts, props.period.from, props.period.to);
  const conv = trialConversion(props.accounts);
  const churn = churnPct(props.accountsAtStart, props.churnedThisPeriod);

  return (
    <div className="vendor-pulse">
      <header className="doc-head"><h2>Пульс</h2></header>
      <div className="pulse-kpis">
        <div className="pulse-card">
          <span>MRR</span>
          <b className="money">{fmt(currentMrr)}</b>
          {growthPct !== null && (
            <span className={`delta delta-${growthPct >= 0 ? 'up' : 'down'}`}>
              {growthPct >= 0 ? '+' : ''}{growthPct}% к прошлому месяцу
            </span>
          )}
        </div>
        <div className="pulse-card">
          <span>ARR</span>
          <b className="money">{fmt(arr(props.accounts))}</b>
          <span className="pulse-note">по текущей подписке</span>
        </div>
        <div className="pulse-card">
          <span>Новых за период</span>
          <b>{src.total}</b>
          <span className="pulse-note">{src.self} сами, {src.dealer} через дилеров</span>
        </div>
        <div className="pulse-card">
          <span>Отток</span>
          <b>{churn}%</b>
          <span className="pulse-note">ушло {props.churnedThisPeriod} из {props.accountsAtStart}</span>
        </div>
      </div>

      <div className="pulse-kpis">
        <div className="pulse-card">
          <span>Конверсия пробного</span>
          <b>{conv.toPaidPct}%</b>
          {/* Ключевая метрика активации: первый чек — точка невозврата */}
          <span className="pulse-note">
            кто дошёл до первого чека — {conv.paidAmongActivatedPct}%
          </span>
        </div>
        <div className="pulse-card">
          <span>Дошли до первого чека</span>
          <b>{conv.reachedFirstReceipt} из {conv.startedTrial}</b>
          <span className="pulse-note">{conv.toReceiptPct}% активации</span>
        </div>
        <div className="pulse-card">
          <span>Средний чек клиента</span>
          <b className="money">{fmt(arpa(props.accounts))}</b>
          <span className="pulse-note">ARPA в месяц</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════ ЗДОРОВЬЕ КЛИЕНТОВ ═══════════════

const LEVEL_LABEL: Record<RiskLevel, string> = {
  critical: 'Критично', high: 'Высокий', medium: 'Средний', ok: 'Норма',
};

export function ClientHealth(props: {
  telemetry: AccountTelemetry[];
  totalMrr: number;
  now: Date;
  onCall: (accountId: string) => void;
  onExport: () => void;
}) {
  const [level, setLevel] = useState<RiskLevel | 'all'>('all');
  const rows = useMemo(
    () => props.telemetry.map((t) => assessRisk(t, props.now)),
    [props.telemetry, props.now]);
  const summary = healthSummary(rows, props.totalMrr);
  const queue = useMemo(
    () => callQueue(rows).filter((r) => level === 'all' || r.level === level),
    [rows, level]);

  return (
    <div className="client-health">
      <header className="health-head">
        <div>
          <h2>Здоровье клиентов</h2>
          <span className="health-sub">Кто уйдёт, если сегодня не позвонить</span>
        </div>
        <button className="btn" onClick={props.onExport}>Выгрузить список</button>
      </header>

      <div className="risk-kpis">
        <div className="risk-kpi">
          <span>Обзвон на сегодня</span><b>{summary.callsToday}</b>
        </div>
        <div className="risk-kpi at-risk">
          <span>MRR под риском</span>
          <b className="money">{fmt(summary.mrrAtRisk)}</b>
          <span className="risk-share">это {summary.shareOfMrrPct}% от всего MRR</span>
        </div>
        <div className="risk-kpi">
          <span>Касса не в сети</span><b>{summary.byLevel.critical}</b>
          <span className="risk-share">больше суток молчит</span>
        </div>
        <div className="risk-kpi">
          <span>Ноль чеков</span><b>{summary.byLevel.high}</b>
          <span className="risk-share">за последнюю неделю</span>
        </div>
      </div>

      <div className="filters">
        {(['all', 'critical', 'high', 'medium'] as const).map((l) => (
          <button key={l} className={`btn ${level === l ? 'btn-accent' : ''}`}
            onClick={() => setLevel(l)}>
            {l === 'all' ? 'Все' : LEVEL_LABEL[l]}
          </button>
        ))}
      </div>

      <table className="doc-table">
        <thead><tr>
          <th>Заведение</th><th>Что случилось</th><th>MRR</th><th>Последний контакт</th><th />
        </tr></thead>
        <tbody>
          {queue.map((r: RiskRow) => (
            <tr key={r.accountId} className={`risk-row-${r.level}`}>
              <td><b>{r.name}</b></td>
              <td>
                <span className="risk-reason">{r.reason}</span>
                <em className="risk-metric"> · {r.metric}</em>
              </td>
              <td className="money">{fmt(r.mrr)}</td>
              <td className="unit">
                {r.daysSinceContact === null ? 'не связывались' : `${r.daysSinceContact} дн назад`}
              </td>
              <td><button className="btn btn-call" onClick={() => props.onCall(r.accountId)}>Позвонить</button></td>
            </tr>
          ))}
          {queue.length === 0 && (
            <tr><td colSpan={5} className="empty-cell">
              Все клиенты в порядке — звонить сегодня некому 👌
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// apps/dealer/src/DealerScreens.tsx
// КАБИНЕТ ДИЛЕРА — экран партнёра.
// Против бюрократии r_keeper (регистрация клиента в 5 шагов через l.ucs со
// статусами заявки) — у нас «Завести клиента» одной кнопкой.
// Против разовых бонусов — комиссия recurring: дилер получает процент, пока
// клиент платит. Поэтому главный экран показывает не «сколько заработал»,
// а «сколько зарабатываю каждый месяц и что этому угрожает».
// ═══ Словарь кабинета дилера — ТОЧНО из макета Claude Design ═══
export const DEALER_T = {
  myClients:   { ru: 'Мои клиенты', kk: 'Менің клиенттерім' },
  stands:      { ru: 'Демо-стенды', kk: 'Демо-стендтер' },
  materials:   { ru: 'Материалы для продаж', kk: 'Сатуға арналған материалдар' },
  accred:      { ru: 'Аккредитация', kk: 'Аккредиттеу' },
  commission:  { ru: 'Комиссия', kk: 'Комиссия' },
  all:         { ru: 'Все', kk: 'Барлығы' },
  paying:      { ru: 'Платят', kk: 'Төлейді' },
  trials:      { ru: 'Пробные', kk: 'Сынақтағы' },
  debts:       { ru: 'Долги', kk: 'Қарыздар' },
  noDebts:     { ru: 'Долгов нет', kk: 'Қарыз жоқ' },
  accrued:     { ru: 'Начислено', kk: 'Есептелген' },
  paidOut:     { ru: 'Выплачено', kk: 'Төленген' },
  payingCount: { ru: 'Платящих клиентов', kk: 'Төлейтін клиенттер' },
  trainedCount:{ ru: 'Обученных кассиров', kk: 'Оқытылған кассирлер' },
  lifetime:    { ru: 'Средний срок жизни клиента', kk: 'Клиенттің орташа өмір сүру мерзімі' },
  call:        { ru: 'Позвонить', kk: 'Қоңырау шалу' },
  write:       { ru: 'Написать владельцу', kk: 'Иесіне жазу' },
  remind:      { ru: 'Напомнить', kk: 'Еске салу' },
  open:        { ru: 'Открыть', kk: 'Ашу' },
  giveToClient:{ ru: 'Выдать клиенту', kk: 'Клиентке беру' },
  extendWeek:  { ru: 'Продлить на неделю', kk: 'Аптаға ұзарту' },
  freeStand:   { ru: 'Свободный стенд', kk: 'Бос стенд' },
  canGive7:    { ru: 'можно выдать на 7 дней', kk: '7 күнге беруге болады' },
  emptyT:      { ru: 'Здесь пока пусто', kk: 'Мұнда әзірге бос' },
  tierTitle:   { ru: 'Категория партнёра и ставка комиссии', kk: 'Серіктес санаты және комиссия мөлшері' },
} as const;

/** Материалы для продаж — состав из макета. */
export const DEALER_MATERIALS = [
  { key: 'deck',  title: 'Презентация для владельца', note: '12 слайдов: против iiko и Poster, без воды' },
  { key: 'price', title: 'Прайс и калькулятор',       note: 'считает цену по точкам и кассам при клиенте' },
  { key: 'shots', title: 'Скриншоты кассы и дашборда', note: 'тёмная касса, KDS, отчёт «Прибыль» — 14 файлов' },
  { key: 'doc',   title: 'Шаблон договора',            note: 'на ИП и на ТОО, с приложением по точкам' },
  { key: 'train', title: 'Обучение кассира',           note: '9 минут: смена, чек, оплата, возврат' },
] as const;

/** Риск-подпись клиента дилера — формулировки из макета. */
export function clientRiskNote(c: {
  status: string; trialDaysLeft?: number; receiptsLast2d?: number; overdueDays?: number; graceDaysLeft?: number;
}): string | null {
  if (c.status === 'TRIAL' && (c.trialDaysLeft ?? 99) <= 4 && (c.receiptsLast2d ?? 1) === 0)
    return `пробный кончается через ${c.trialDaysLeft} дня, ни одного чека за 2 дня`;
  if ((c.overdueDays ?? 0) > 0)
    return `просрочка ${c.overdueDays} дней — касса работает ещё ${c.graceDaysLeft ?? 0} дней`;
  return null;
}

import React, { useMemo, useState } from 'react';
import {
  dealerPortfolio, clientCommission, clientAction, commissionAtRisk,
  nextPayoutDate, payoutForecast, paidTotal, commissionGrowthPct,
  demoStandState, demoConversionRate, accreditationSteps, accreditationProgress,
  // ── дизайн-ревизия: категории, субдилеры, порог выплаты ──
  currentTier, nextTierProgress, DEALER_TIERS, splitWithParent, subDealersOf,
  payableNow, MIN_PAYOUT,
} from '../../api/src/platform/dealer.logic';
import type { DealerClient, MonthlyAccrual, DemoStand, DealerNode } from '../../api/src/platform/dealer.logic';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

const STATUS_LABEL: Record<DealerClient['status'], string> = {
  TRIAL: 'Пробный', ACTIVE: 'Платит', PAST_DUE: 'Не оплатил',
  SUSPENDED: 'Приостановлен', CHURNED: 'Ушёл',
};

export function DealerCabinet(props: {
  dealer: { name: string; city: string; commissionPct: number; accredited: boolean };
  clients: DealerClient[];
  accruals: MonthlyAccrual[];
  stands: DemoStand[];
  now: Date;
  prevMonthCommission: number;
  accreditationState: Record<string, boolean>;
  onAddClient: () => void;
  onMaterials: () => void;
  onCallClient: (accountId: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | DealerClient['status']>('all');
  const p = dealerPortfolio(props.clients, props.dealer.commissionPct, props.now);
  const risk = commissionAtRisk(props.clients, props.dealer.commissionPct);
  const growth = commissionGrowthPct(p.monthlyCommission, props.prevMonthCommission);
  const payout = payoutForecast(props.accruals, p.monthlyCommission);
  const payoutDate = nextPayoutDate(props.now);
  const accSteps = accreditationSteps(props.accreditationState);
  const acc = accreditationProgress(accSteps);

  const rows = useMemo(
    () => props.clients.filter((c) => filter === 'all' || c.status === filter),
    [props.clients, filter]);

  // Не аккредитован — показываем только путь к аккредитации
  if (!props.dealer.accredited) {
    return (
      <div className="dealer-cabinet">
        <header className="doc-head"><h2>Аккредитация партнёра</h2></header>
        <section className="card">
          <div className="progress"><div style={{ width: `${acc.pct}%` }} /></div>
          <p className="hint">Готово {acc.pct}%. После аккредитации получите демо-стенды и ставку комиссии.</p>
          <ol className="onb-steps">
            {accSteps.map((s) => (
              <li key={s.id} className={s.done ? 'done' : ''}>
                <span>{s.done ? '✓' : '○'} {s.name}</span>
                {!s.done && <button className="btn">Заполнить</button>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="dealer-cabinet">
      <header className="dealer-head">
        <div>
          <h2>{props.dealer.name}</h2>
          <span className="unit">{props.dealer.city} · аккредитован · ставка {props.dealer.commissionPct}%</span>
        </div>
        <div className="payout-box">
          <span>Выплата {fmtDate(payoutDate)}</span>
          <b className="money">{fmt(payout.ready)}</b>
          <em>Приходит на счёт после закрытия месяца, без заявки.</em>
        </div>
        <div className="dealer-actions">
          <button className="btn" onClick={props.onMaterials}>Материалы для продаж</button>
          <button className="btn btn-accent" onClick={props.onAddClient}>Завести клиента</button>
        </div>
      </header>

      <div className="pulse-kpis">
        <div className="pulse-card">
          <span>Комиссия в этом месяце</span>
          <b className="money">{fmt(p.monthlyCommission)}</b>
          {growth !== null && (
            <span className={`delta delta-${growth >= 0 ? 'up' : 'down'}`}>
              {growth >= 0 ? '+' : ''}{growth}% к прошлому
            </span>
          )}
        </div>
        <div className="pulse-card">
          <span>Клиентов платят</span>
          <b>{p.payingCount}</b>
          <span className="pulse-note">из {p.totalClients} заведённых</span>
        </div>
        <div className="pulse-card">
          <span>На пробном</span>
          <b>{p.trialCount}</b>
          <span className="pulse-note">
            {p.trialSoon > 0 ? `${p.trialSoon} заканчивается на этой неделе` : 'все с запасом времени'}
          </span>
        </div>
        {/* Наша добавка: дилер видит, сколько своих денег теряет */}
        <div className={`pulse-card ${risk.amount > 0 ? 'risk-card' : ''}`}>
          <span>Комиссия под риском</span>
          <b className="money">{fmt(risk.amount)}</b>
          <span className="pulse-note">
            {risk.clients > 0 ? `${risk.clients} клиентов перестали платить` : 'все клиенты в порядке'}
          </span>
        </div>
      </div>

      <section className="card">
        <div className="doc-head"><h3>Мои клиенты</h3></div>
        <div className="filters">
          {(['all', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'CHURNED'] as const).map((f) => (
            <button key={f} className={`btn ${filter === f ? 'btn-accent' : ''}`}
              onClick={() => setFilter(f)}>
              {f === 'all' ? 'Все' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
        <table className="doc-table">
          <thead><tr>
            <th>Заведение</th><th>Статус</th><th>Платит / мес</th><th>Ваша комиссия</th><th>Действие</th>
          </tr></thead>
          <tbody>
            {rows.map((c) => {
              const act = clientAction(c, props.now);
              return (
                <tr key={c.accountId} className={act.urgency === 'high' ? 'row-warn' : ''}>
                  <td><b>{c.name}</b>{c.city && <em className="unit"> · {c.city}</em>}</td>
                  <td className={`cl-${c.status.toLowerCase()}`}>{STATUS_LABEL[c.status]}</td>
                  <td className="money">{c.status === 'TRIAL' ? '—' : fmt(c.monthlyPayment)}</td>
                  <td className="money">{fmt(clientCommission(c, props.dealer.commissionPct))}</td>
                  <td>
                    {act.label && (
                      <button className={`btn ${act.urgency === 'high' ? 'btn-call' : ''}`}
                        onClick={() => props.onCallClient(c.accountId)}>{act.label}</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="empty-cell">
                {filter === 'all'
                  ? 'Клиентов пока нет. Заведите первого — комиссия начнёт капать со следующего платежа.'
                  : 'В этой категории пусто'}
              </td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Начисления по месяцам</h3>
        <p className="hint">Ставка {props.dealer.commissionPct}% от поступивших платежей ваших клиентов.</p>
        <table className="doc-table">
          <thead><tr><th>Месяц</th><th>Платежей</th><th>База</th><th>Комиссия</th><th>Выплата</th></tr></thead>
          <tbody>
            {props.accruals.map((a) => (
              <tr key={a.month}>
                <td>{a.month}</td>
                <td>{a.paymentsCount}</td>
                <td className="money">{fmt(a.base)}</td>
                <td className="money strong">{fmt(a.commission)}</td>
                <td className={a.status === 'PAID' ? 'ok' : 'unit'}>
                  {a.status === 'PAID' ? 'Выплачено' : a.status === 'SCHEDULED' ? `${fmtDate(payoutDate)}` : 'Начисляется'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Выплачено за полгода: <b className="money">{fmt(paidTotal(props.accruals))}</b></p>
      </section>

      <section className="card">
        <div className="doc-head">
          <h3>Демо-стенды</h3>
          <span className="unit">конверсия {demoConversionRate(props.stands)}%</span>
        </div>
        <div className="stands-list">
          {props.stands.map((s) => {
            const st = demoStandState(s, props.now);
            return (
              <div key={s.id} className={`stand-row stand-${st.state}`}>
                <b>{s.issuedTo}</b>
                <span className="unit">выдан {fmtDate(s.issuedAt)}</span>
                <span className="stand-label">{st.label}</span>
              </div>
            );
          })}
          {props.stands.length === 0 && (
            <p className="empty-cell">Стендов нет. Запросите — покажете систему клиенту вживую.</p>
          )}
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ДОПОЛНЕНИЕ ДИЗАЙН-РЕВИЗИИ: категории и субдилеры
// Макет обещает «категория пересчитывается 1-го числа, заявку писать
// не нужно» — значит дилер должен видеть лестницу и своё место на ней.
// Субдилеры — модель r_keeper License.
// ═══════════════════════════════════════════════════════════════════
/** Блок «Категория и ставка» — цель видна без звонка менеджеру. */
export function DealerTierBlock(props: { payingClients: number; monthlyBase: number }) {
  const tier = currentTier(props.payingClients, props.monthlyBase);
  const next = nextTierProgress(props.payingClients, props.monthlyBase);
  return (
    <section className="dl-tier">
      <header>
        <h3>Категория «{tier.name}» — ставка {tier.ratePct}%</h3>
        <span className="dl-note">Пересчитывается 1-го числа автоматически</span>
      </header>
      <ol className="tier-ladder">
        {DEALER_TIERS.map((t) => (
          <li key={t.id} className={t.id === tier.id ? 'on' : ''}>
            <b>{t.name}</b>
            <span>{t.ratePct}%</span>
            <em>от {t.minPayingClients} клиентов и {fmt(t.minMonthlyBase)} базы</em>
          </li>
        ))}
      </ol>
      {next ? (
        <p className="tier-next">
          До «{next.next.name}» ({next.next.ratePct}%):{' '}
          {next.needClients > 0 && <b>+{next.needClients} платящих клиентов</b>}
          {next.needClients > 0 && next.needBase > 0 && ' и '}
          {next.needBase > 0 && <b>+{fmt(next.needBase)} к базе платежей</b>}
          {next.needClients === 0 && next.needBase === 0 && <b>условия выполнены — ставка поднимется 1-го числа</b>}
        </p>
      ) : (
        <p className="tier-next">Высшая категория достигнута.</p>
      )}
    </section>
  );
}

/** Блок выплаты с порогом: мелочь переносим, а не гоняем переводами. */
export function DealerPayoutBlock(props: { accrued: number; carriedOver?: number; payoutAt: Date }) {
  const p = payableNow(props.accrued, props.carriedOver ?? 0);
  return (
    <div className="dl-payout">
      <span>Выплата {fmtDate(props.payoutAt)}</span>
      <b className="money">{fmt(p.pay)}</b>
      <em>
        {p.note
          ? `${p.note}. Минимум к выплате — ${fmt(MIN_PAYOUT)}, накоплено ${fmt(p.carryOver)}.`
          : 'Приходит на ИП после закрытия месяца, без заявки.'}
      </em>
    </div>
  );
}

/** Субдилеры: своя сеть партнёров и доля, уходящая куратору. */
export function SubDealersBlock(props: {
  me: DealerNode;
  all: DealerNode[];
  myCommission: number;
  subCommissions: Record<string, number>;
}) {
  const subs = subDealersOf(props.me.dealerId, props.all);
  const split = splitWithParent(props.myCommission, props.me);
  if (!subs.length && !props.me.parentDealerId) return null;
  return (
    <section className="dl-subs">
      <h3>Партнёрская сеть</h3>
      {props.me.parentDealerId && (
        <p className="dl-note">
          Вы работаете под куратором: {props.me.parentSharePct}% вашей комиссии ({fmt(split.toParent)}) уходит ему.
          На руки — {fmt(split.toDealer)}.
        </p>
      )}
      {subs.length > 0 && (
        <>
          <p className="dl-note">Ваши субдилеры: {subs.length}. С их комиссии вы получаете свою долю.</p>
          <table className="doc-table">
            <thead><tr><th>Субдилер</th><th>Его комиссия</th><th>Ваша доля</th></tr></thead>
            <tbody>
              {subs.map((s) => {
                const c = props.subCommissions[s.dealerId] ?? 0;
                const sp = splitWithParent(c, s);
                return (
                  <tr key={s.dealerId}>
                    <td>{s.name}</td>
                    <td className="money">{fmt(c)}</td>
                    <td className="money ok">{fmt(sp.toParent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

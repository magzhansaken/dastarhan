// apps/billing/src/BillingScreens.tsx
// БИЛЛИНГ-КАБИНЕТ КЛИЕНТА — экран «Оплата и тариф».
// Тон экрана — принципиальный: при неоплате мы не пугаем красным замком,
// а честно говорим, что именно работает. Касса не гаснет 7 дней, закрыть
// смену можно всегда. Это наш козырь против рубильника у конкурентов.
import React, { useState } from 'react';
import {
  PLANS, planByKey, billingBreakdown, addLocationCost, planChange,
  invoiceStatusLabel, closingDocs, billingState, whatWorks, canRequestDeferral,
  // ── дизайн-ревизия: замок по тарифу ──
  featureLock, featuresLostOnDowngrade,
} from '../../api/src/platform/billing.logic';
import type { Plan, LocationBilling, Invoice } from '../../api/src/platform/billing.logic';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

// ═══ Словарь биллинга — ТОЧНО из макета «Биллинг клиента» Claude Design ═══
export const BILL_T = {
  active:     { ru: 'Активна', kk: 'Белсенді' },
  working:    { ru: 'Работает', kk: 'Жұмыс істейді' },
  soonRenew:  { ru: 'Скоро продление', kk: 'Жақында ұзарту' },
  paidTill:   { ru: 'Оплачено до', kk: 'Төленген' },
  paid:       { ru: 'Оплачен', kk: 'Төленген' },
  waiting:    { ru: 'Ждёт оплаты', kk: 'Төлемді күтуде' },
  overdue:    { ru: 'Просрочен', kk: 'Мерзімі өтті' },
  notPaid:    { ru: 'Не оплачено', kk: 'Төленбеген' },
  pay:        { ru: 'Оплатить', kk: 'Төлеу' },
  receipt:    { ru: 'Квитанция', kk: 'Түбіртек' },
  billTo:     { ru: 'счёт на', kk: 'шот' },
} as const;

/** Состав тарифа — подписи из макета (что именно работает у клиента). */
export const PLAN_FEATURES = [
  { key: 'pos',      title: 'Касса и чеки',          plans: ['START','BUSINESS','NETWORK'] },
  { key: 'shifts',   title: 'Смены и наличные',      plans: ['START','BUSINESS','NETWORK'] },
  { key: 'stock',    title: 'Склад и техкарты',      plans: ['START','BUSINESS','NETWORK'] },
  { key: 'fiscal',   title: 'Фискализация Webkassa', plans: ['START','BUSINESS','NETWORK'] },
  { key: 'kaspi',    title: 'Kaspi QR на кассе',     plans: ['START','BUSINESS','NETWORK'] },
  { key: 'reports',  title: 'Отчёты и прибыль',      plans: ['BUSINESS','NETWORK'] },
  { key: 'delivery', title: 'Доставка и курьеры',    plans: ['BUSINESS','NETWORK'] },
  { key: 'loyalty',  title: 'Лояльность',            plans: ['BUSINESS','NETWORK'] },
  { key: 'ai',       title: 'ИИ-помощник',           plans: ['BUSINESS','NETWORK'] },
  { key: 'central',  title: 'Центральный склад',     plans: ['NETWORK'] },
] as const;

/** Порядковое числительное для подсказки «Четвёртая точка добавит …». */
export function ordinalLocation(n: number): string {
  const words = ['Первая','Вторая','Третья','Четвёртая','Пятая','Шестая','Седьмая','Восьмая','Девятая','Десятая'];
  return words[n - 1] ?? `${n}-я`;
}

/** Статус счёта словами — из макета: «Просрочен 1 день». */
export function invoiceStatusLabel(status: string, daysOverdue = 0): string {
  if (status === 'PAID') return BILL_T.paid.ru;
  if (status === 'OVERDUE' || daysOverdue > 0) {
    const d = daysOverdue;
    const word = d % 10 === 1 && d % 100 !== 11 ? 'день' : (d % 10 >= 2 && d % 10 <= 4 && (d % 100 < 12 || d % 100 > 14)) ? 'дня' : 'дней';
    return `${BILL_T.overdue.ru} ${d} ${word}`;
  }
  return BILL_T.waiting.ru;
}

export function BillingScreen(props: {
  planKey: Plan['key'];
  locations: LocationBilling[];
  invoices: Invoice[];
  now: Date;
  periodEnd: Date;
  payToName: string;              // «ИП Смагулов Е.» — кому уходит платёж
  lastDeferralAt: Date | null;
  onPayKaspi: (invoiceId: string) => void;
  onAddLocation: () => void;
  onChangePlan: (key: Plan['key']) => void;
  onRequestDeferral: () => void;
  onDownloadDocs: (invoiceId: string) => void;
}) {
  const plan = planByKey(props.planKey);
  const bd = billingBreakdown(plan, props.locations);
  const openInvoice = props.invoices.find((i) => i.status === 'PENDING' || i.status === 'OVERDUE') ?? null;
  const state = billingState(openInvoice, props.now);
  const works = whatWorks(state.state);
  const addCost = addLocationCost(plan, props.now, props.periodEnd);
  const deferral = canRequestDeferral(props.lastDeferralAt, props.now);
  const [comparing, setComparing] = useState(false);

  return (
    <div className="billing-screen">
      <header className="doc-head">
        <h2>Оплата и тариф</h2>
        <span className="unit">Следующее списание {fmtDate(props.periodEnd)}</span>
      </header>

      {/* ── Баннер состояния: спокойный тон вместо блокировки ── */}
      <section className={`bill-banner bill-${state.state.toLowerCase()}`}>
        <div>
          <h3>{state.title}</h3>
          <p>{state.body}</p>
        </div>
        {openInvoice && (
          <button className="btn btn-accent bill-pay"
            onClick={() => props.onPayKaspi(openInvoice.id)}>
            Оплатить {fmt(openInvoice.amount)} через Kaspi
          </button>
        )}
      </section>

      {/* ── Что работает прямо сейчас ── */}
      <section className="card works-card">
        <h3>Что работает сейчас</h3>
        <ul className="works-list">
          {works.map((w) => (
            <li key={w.name} className={w.ok ? 'w-ok' : 'w-off'}>
              <span className="w-mark">{w.ok ? '✓' : '—'}</span>{w.name}
            </li>
          ))}
        </ul>
        {state.state !== 'ACTIVE' && (
          <p className="hint">Закрыть смену и снять Z-отчёт можно в любом состоянии — это требование закона, а не тарифа.</p>
        )}
      </section>

      {/* ── Разбивка платежа ── */}
      <section className="card">
        <h3>Из чего складывается платёж</h3>
        <table className="pnl-table"><tbody>
          {bd.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.label}</td>
              <td className="unit">{l.qty} × {fmt(l.unit)}</td>
              <td className="money">{fmt(l.sum)}</td>
            </tr>
          ))}
          <tr className="row-strong">
            <td>Итого в месяц</td><td /><td className="money">{fmt(bd.total)}</td>
          </tr>
        </tbody></table>
        <p className="hint">
          Оплата уходит на {props.payToName}. Закрывающие документы — счёт, акт и счёт-фактура —
          придут на почту сразу после оплаты, каким бы способом вы ни платили.
        </p>
      </section>

      {/* ── Точки и кассы ── */}
      <section className="card">
        <h3>Точки и кассы</h3>
        <div className="loc-list">
          {props.locations.map((l) => (
            <div key={l.id} className="loc-row">
              <div>
                <b>{l.name}</b>
                {l.address && <em className="unit"> · {l.address}</em>}
              </div>
              <span className="unit">{l.terminals} {l.terminals === 1 ? 'касса' : 'кассы'}</span>
              <b className="money">
                {fmt(plan.pricePerLocation + Math.max(0, l.terminals - plan.includedTerminalsPerLocation) * plan.extraTerminalPrice)}
              </b>
            </div>
          ))}
        </div>
        <button className="btn" onClick={props.onAddLocation}>Добавить точку</button>
        <p className="hint">
          Добавили точку — цена пересчитается с этого дня: {fmt(addCost.chargeNow)} за оставшиеся
          {' '}{addCost.daysLeft} дн, дальше +{fmt(addCost.monthlyDelta)} в месяц. Убрали — тоже пересчитается.
        </p>
      </section>

      {/* ── Счета ── */}
      <section className="card">
        <h3>Счета</h3>
        <table className="doc-table">
          <thead><tr><th>Счёт</th><th>Период</th><th>Сумма</th><th>Статус</th><th /></tr></thead>
          <tbody>
            {props.invoices.map((i) => {
              const st = invoiceStatusLabel(i, props.now);
              const docs = closingDocs(i);
              return (
                <tr key={i.id}>
                  <td>№{i.number}</td>
                  <td className="unit">{fmtDate(i.periodFrom)} — {fmtDate(i.periodTo)}</td>
                  <td className="money">{fmt(i.amount)}</td>
                  <td className={`inv-${st.tone}`}>{st.text}</td>
                  <td>
                    {docs.available
                      ? <button className="btn" onClick={() => props.onDownloadDocs(i.id)}>Документы</button>
                      : <button className="btn btn-accent" onClick={() => props.onPayKaspi(i.id)}>Оплатить</button>}
                  </td>
                </tr>
              );
            })}
            {props.invoices.length === 0 && (
              <tr><td colSpan={5} className="empty-cell">Счетов пока не было — вы на пробном периоде</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ── Сравнение тарифов ── */}
      <section className="card">
        <div className="doc-head">
          <h3>Тариф</h3>
          <button className="btn" onClick={() => setComparing(!comparing)}>
            {comparing ? 'Свернуть' : 'Сравнить тарифы'}
          </button>
        </div>
        <div className="plans-row">
          {PLANS.map((p) => {
            const change = planChange(plan, p, props.locations.length, props.now, props.periodEnd);
            const current = p.key === plan.key;
            return (
              <div key={p.key} className={`plan-card ${current ? 'plan-current' : ''}`}>
                {current && <span className="plan-badge">ВАШ</span>}
                <h4>{p.name}</h4>
                <b className="money plan-price">{fmt(p.pricePerLocation)}</b>
                <span className="unit">/ точка в месяц</span>
                <p className="plan-summary">{p.summary}</p>
                {comparing && (
                  <ul className="plan-features">
                    {p.features.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
                {current
                  ? <button className="btn" disabled>Текущий</button>
                  : (
                    <button className="btn btn-accent" onClick={() => props.onChangePlan(p.key)}>
                      {change.direction === 'upgrade' ? `Перейти на «${p.name}»` : `Понизить до «${p.name}»`}
                    </button>
                  )}
                {!current && <p className="plan-note">{change.note}</p>}
                {!current && change.chargeNow > 0 && (
                  <p className="plan-note">Доплата сейчас: <b>{fmt(change.chargeNow)}</b></p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Отсрочка ── */}
      <section className="card defer-card">
        <h3>Нужна отсрочка?</h3>
        <p>
          Напишите — дадим ещё 7 дней без вопросов. Один раз в квартал это нормально,
          у всех бывает трудный месяц.
        </p>
        <button className="btn" disabled={!deferral.allowed} onClick={props.onRequestDeferral}>
          Попросить отсрочку
        </button>
        {!deferral.allowed && <p className="hint">{deferral.reason}</p>}
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ДОПОЛНЕНИЕ ДИЗАЙН-РЕВИЗИИ: замок по тарифу
// Из каталога состояний Claude Design: раздел, закрытый тарифом, не должен
// выглядеть поломкой. Показываем ЦЕННОСТЬ, а не запрет, и что именно
// потеряется при понижении — до перехода, а не после.
// ═══════════════════════════════════════════════════════════════════
/** Заглушка вместо закрытого раздела. Возвращает детей, если тариф позволяет. */
export function FeatureGate(props: {
  feature: string;
  plan: Plan['key'];
  onCompare: () => void;
  children: React.ReactNode;
}) {
  const lock = featureLock(props.feature, props.plan);
  if (!lock) return <>{props.children}</>;
  return (
    <div className="feature-lock">
      <div className="lock-icon">🔒</div>
      <h3>{lock.title}</h3>
      <p>{lock.body}</p>
      {lock.priceDiff > 0 && (
        <p className="lock-price">Разница в цене — {fmt(lock.priceDiff)} за точку в месяц</p>
      )}
      <button className="btn btn-accent" onClick={props.onCompare}>{lock.cta}</button>
    </div>
  );
}

/** Предупреждение перед понижением тарифа: что именно отключится. */
export function DowngradeWarning(props: {
  from: Plan['key']; to: Plan['key'];
  effectiveAt: Date;
  onConfirm: () => void; onCancel: () => void;
}) {
  const lost = featuresLostOnDowngrade(props.from, props.to);
  return (
    <div className="downgrade-warn">
      <h3>Что отключится при переходе на «{planByKey(props.to).name}»</h3>
      {lost.length > 0 ? (
        <ul className="lost-list">
          {lost.map((f) => <li key={f}>— {f}</li>)}
        </ul>
      ) : (
        <p>Ничего не отключится.</p>
      )}
      <p className="dl-note">
        Переход действует с {fmtDate(props.effectiveAt)}. До этой даты работает текущий тариф —
        вы за него уже заплатили, деньги не сгорают.
      </p>
      <div className="dw-actions">
        <button className="btn" onClick={props.onCancel}>Оставить как есть</button>
        <button className="btn btn-danger" onClick={props.onConfirm}>Всё равно понизить</button>
      </div>
    </div>
  );
}

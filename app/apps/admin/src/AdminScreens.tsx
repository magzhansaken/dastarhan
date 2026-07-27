// apps/admin/src/AdminScreens.tsx
// Экраны панели вендора: дашборд платформы, клиенты со здоровьем,
// карточка клиента (подписка/счета/SOS/вход как клиент), дилеры.
import React, { useMemo, useState } from 'react';
import {
  AccountRow, platformDashboard, healthScore, rescueQueue, Health,
  Invoice, invoiceStatusAt, annualOffer, SOS_REASONS, SosCode, sosActive,
  DealerRow, dealerPayout, dunningPlan,
} from './platform.viewmodels';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
const d2 = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

const STATUS_RU: Record<AccountRow['status'], string> = {
  TRIAL: 'Пробный', ACTIVE: 'Активен', PAST_DUE: 'Просрочка',
  SUSPENDED: 'Приостановлен', CANCELLED: 'Ушёл',
};
const HEALTH_RU: Record<Health['level'], string> = {
  healthy: 'здоров', watch: 'наблюдение', at_risk: 'риск', dying: 'умирает',
};

// ═══ ДАШБОРД ПЛАТФОРМЫ ═══
export function PlatformDashboard({ accounts, now }: { accounts: AccountRow[]; now: Date }) {
  const d = platformDashboard(accounts, now);
  const rescue = rescueQueue(accounts, now, 5);
  return (
    <div className="adm-page">
      <h2>Платформа сегодня</h2>
      <div className="adm-kpis">
        <div className="adm-kpi adm-kpi-main">
          <span>MRR</span><b className="money">{fmt(d.mrr)}</b>
          <em>{d.payingAccounts} клиентов · {d.locations} точек</em>
        </div>
        <div className="adm-kpi"><span>Средний чек клиента</span><b className="money">{fmt(d.arpu)}</b></div>
        <div className="adm-kpi"><span>На пробном</span><b>{d.trials}</b><em>конвертировать</em></div>
        <div className="adm-kpi adm-kpi-warn"><span>Просрочка</span><b>{d.pastDue}</b>
          <em className="money">{fmt(d.pastDueMoney)} под угрозой</em></div>
        <div className="adm-kpi"><span>Продление ≤7 дней</span><b>{d.expiringSoon}</b></div>
      </div>

      <section className="adm-block">
        <h3>Кого спасать сейчас</h3>
        {rescue.length === 0 && <p className="adm-ok">Все клиенты здоровы 👌</p>}
        <ul className="adm-rescue">
          {rescue.map(({ row, health }) => (
            <li key={row.accountId} className={`adm-r adm-h-${health.level}`}>
              <b>{row.name}</b>
              <span className="adm-city">{row.city}</span>
              <span className={`adm-badge adm-h-${health.level}`}>{HEALTH_RU[health.level]} · {health.score}</span>
              <span className="adm-reasons">{health.reasons.join(' · ')}</span>
              <span className="money">{fmt(row.mrr)}/мес</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ═══ СПИСОК КЛИЕНТОВ ═══
export function AccountsScreen(props: {
  accounts: AccountRow[]; now: Date; onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [onlyProblem, setOnlyProblem] = useState(false);
  const rows = useMemo(() => {
    const norm = (s: string) => s.toLowerCase();
    return props.accounts
      .map((a) => ({ a, h: healthScore(a, props.now) }))
      .filter(({ a, h }) => {
        if (q && !norm(a.name).includes(norm(q)) && !norm(a.city).includes(norm(q))) return false;
        if (onlyProblem && h.level !== 'at_risk' && h.level !== 'dying' && a.status !== 'PAST_DUE') return false;
        return true;
      });
  }, [props.accounts, q, onlyProblem, props.now]);

  return (
    <div className="adm-page">
      <h2>Клиенты</h2>
      <div className="adm-filters">
        <input className="adm-search" placeholder="Поиск по названию или городу"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={onlyProblem}
          onChange={() => setOnlyProblem(!onlyProblem)} /> только проблемные</label>
        <span className="adm-count">{rows.length}</span>
      </div>
      <table className="adm-table">
        <thead><tr>
          <th>Клиент</th><th>Город</th><th>Статус</th><th>Точек</th>
          <th>MRR</th><th>Здоровье</th><th>Оплачен до</th>
        </tr></thead>
        <tbody>
          {rows.map(({ a, h }) => (
            <tr key={a.accountId} onClick={() => props.onOpen(a.accountId)} className="adm-row">
              <td><b>{a.name}</b></td>
              <td>{a.city}</td>
              <td><span className={`adm-st adm-st-${a.status.toLowerCase()}`}>{STATUS_RU[a.status]}</span></td>
              <td>{a.locations}</td>
              <td className="money">{fmt(a.mrr)}</td>
              <td><span className={`adm-badge adm-h-${h.level}`}>{h.score}</span></td>
              <td>{d2(a.periodEnd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══ КАРТОЧКА КЛИЕНТА ═══
export function AccountCard(props: {
  account: AccountRow; invoices: Invoice[]; sosHistory: SosCode[]; now: Date;
  onIssueSos: (reason: string) => void;
  onImpersonate: (reason: string) => void;
  onExtend: (months: number) => void;
}) {
  const a = props.account;
  const h = healthScore(a, props.now);
  const annual = annualOffer(a.mrr);
  const activeSos = props.sosHistory.find((s) => sosActive(s, props.now));
  const [sosReason, setSosReason] = useState<string>('');

  return (
    <div className="adm-page adm-card-page">
      <header className="adm-card-head">
        <div>
          <h2>{a.name}</h2>
          <span className="adm-city">{a.city} · {a.vertical} · {a.locations} точек</span>
        </div>
        <span className={`adm-badge adm-h-${h.level}`}>{HEALTH_RU[h.level]} · {h.score}</span>
      </header>

      {h.reasons.length > 0 && (
        <ul className="adm-warnlist">{h.reasons.map((r, i) => <li key={i}>⚠ {r}</li>)}</ul>
      )}

      <div className="adm-cols">
        <section className="adm-block">
          <h3>Подписка</h3>
          <p>Статус: <b>{STATUS_RU[a.status]}</b></p>
          <p>Оплачено до: <b>{d2(a.periodEnd)}</b></p>
          <p>Абонплата: <b className="money">{fmt(a.mrr)}</b> / мес</p>
          <p>Баланс аккаунта: <b className="money">{fmt(a.balance)}</b></p>
          <div className="adm-actions">
            <button className="btn" onClick={() => props.onExtend(1)}>Продлить на месяц</button>
            <button className="btn btn-accent" onClick={() => props.onExtend(12)}>
              Год за {fmt(annual.total)} (−{fmt(annual.saved)})
            </button>
          </div>
        </section>

        <section className="adm-block">
          <h3>Счета</h3>
          <table className="adm-table adm-mini">
            <tbody>
              {props.invoices.map((inv) => {
                const st = invoiceStatusAt(inv, props.now);
                return (
                  <tr key={inv.id}>
                    <td>{inv.number}</td>
                    <td>{d2(inv.periodFrom)}—{d2(inv.periodTo)}</td>
                    <td className="money">{fmt(inv.amount)}</td>
                    <td><span className={`adm-inv adm-inv-${st.toLowerCase()}`}>{st}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="adm-hint">Пополнение через Kaspi Платежи: «Dastarhan», номер аккаунта {a.accountId}</p>
        </section>

        <section className="adm-block">
          <h3>SOS-код (экстренный доступ)</h3>
          {activeSos ? (
            <p className="adm-sos-active">Активен <b>{activeSos.code}</b> до {d2(activeSos.expiresAt)} — {activeSos.reason}</p>
          ) : (
            <>
              <select value={sosReason} onChange={(e) => setSosReason(e.target.value)}>
                <option value="">— причина-обоснование —</option>
                {SOS_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn" disabled={!sosReason}
                onClick={() => props.onIssueSos(sosReason)}>Выдать на 5 дней</button>
            </>
          )}
          <p className="adm-hint">Не более 2 кодов на клиента в квартал. Причина обязательна и логируется.</p>
        </section>

        <section className="adm-block">
          <h3>Поддержка</h3>
          <button className="btn adm-imp" onClick={() => props.onImpersonate('Разбор обращения клиента')}>
            Войти как клиент (только чтение, 60 мин)
          </button>
          <p className="adm-hint">Вход записывается в аудит клиента — он видит, кто и когда заходил.</p>
        </section>
      </div>
    </div>
  );
}

// ═══ ДИЛЕРЫ ═══
export function DealersScreen({ dealers, accounts }: { dealers: DealerRow[]; accounts: AccountRow[] }) {
  return (
    <div className="adm-page">
      <h2>Дилеры</h2>
      <table className="adm-table">
        <thead><tr><th>Дилер</th><th>Регион</th><th>Клиентов живых</th><th>База MRR</th><th>%</th><th>К выплате</th></tr></thead>
        <tbody>
          {dealers.map((d) => {
            const p = dealerPayout(d, accounts);
            return (
              <tr key={d.dealerId}>
                <td><b>{d.name}</b></td>
                <td>{d.region}</td>
                <td>{p.alive}</td>
                <td className="money">{fmt(p.base)}</td>
                <td>{d.commissionPct}%</td>
                <td className="money"><b>{fmt(p.commission)}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="adm-hint">Комиссия recurring — начисляется, пока клиент активен. Дилер заинтересован, чтобы клиент жил.</p>
    </div>
  );
}

// ═══ РАСПИСАНИЕ НАПОМИНАНИЙ (показываем, что система делает сама) ═══
export function DunningScreen({ amount }: { amount: number }) {
  const plan = dunningPlan(amount);
  return (
    <div className="adm-page">
      <h2>Автонапоминания об оплате</h2>
      <ul className="adm-dunning">
        {plan.map((s, i) => (
          <li key={i}>
            <span className={`adm-day ${s.day <= 0 ? 'before' : 'after'}`}>
              {s.day === 0 ? 'день X' : s.day < 0 ? `${s.day} дн.` : `+${s.day} дн.`}
            </span>
            <span className="adm-ch">{s.channel}</span>
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      <p className="adm-hint">Половина оттока — забывчивость, а не отказ. Напоминания возвращают клиента до блокировки.</p>
    </div>
  );
}

// Админка платформы. Команда Dastarhan видит здесь все заведения,
// их выручку, риск оттока, тикеты поддержки, биллинг и матрицу тарифов.
// Каждая вкладка оболочки подключена к своему эндпоинту /admin/*.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './admin.css';
import './platform.css';
import { VendorShell, TicketsScreen, FeatureMatrix, VendorPulse, ClientHealth } from '@dastarhan/vendor-ui';
import type { Ticket } from '@dastarhan/shared/platform/ticket.logic';
import { DunningScreen } from './AdminScreens';

const API = '/api/v1';
const TOKEN = 'dastarhan.admin.token';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// Человеческие названия модулей тарифов — для матрицы функций
const MODULE_RU: Record<string, { title: string; group: string }> = {
  pos:      { title: 'Касса', group: 'Ядро' },
  shifts:   { title: 'Смены и Z-отчёты', group: 'Ядро' },
  fiscal:   { title: 'Фискализация Webkassa', group: 'Ядро' },
  offline:  { title: 'Офлайн-режим', group: 'Ядро' },
  kaspi:    { title: 'Kaspi QR', group: 'Платежи' },
  stock:    { title: 'Склад и себестоимость', group: 'Управление' },
  reports:  { title: 'Отчёты владельца', group: 'Управление' },
  delivery: { title: 'Доставка и курьеры', group: 'Рост' },
  loyalty:  { title: 'Лояльность и купоны', group: 'Рост' },
  booking:  { title: 'Брони и банкеты', group: 'Рост' },
  ai:       { title: 'ИИ-подсказки', group: 'Рост' },
  api:      { title: 'API для интеграций', group: 'Сеть' },
  network:  { title: 'Сводка по сети', group: 'Сеть' },
};

function Login({ onIn }: { onIn: (t: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!r.ok) { setErr('Неверная почта или пароль'); return; }
      const d = await r.json();
      localStorage.setItem(TOKEN, d.access);
      onIn(d.access);
    } catch { setErr('Нет связи с сервером'); }
  };

  return (
    <div className="onb-wizard" style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="label-mono">Админка платформы</div>
      <h2>Вход для команды Dastarhan</h2>
      <div className="onb-fields">
        <label>Почта
          <input className="field-lg" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <label>Пароль
          <input className="field-lg" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
      </div>
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button className="btn btn-primary btn-lg" onClick={submit}>Войти</button>
    </div>
  );
}

// ═══════════════ КЛИЕНТЫ ═══════════════
// Список аккаунтов с тарифом и MRR — прямо из /admin/accounts.

function AccountsView({ token }: { token: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${API}/admin/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [token, q]);

  const STATUS_RU: Record<string, string> = {
    TRIAL: 'Пробный', ACTIVE: 'Оплачен', PAST_DUE: 'Просрочка',
    SUSPENDED: 'Заморожен', CANCELLED: 'Ушёл', NONE: 'Без подписки',
  };

  return (
    <div className="adm-page">
      <h2>Клиенты</h2>
      <div className="adm-filters">
        <input className="search" placeholder="Название заведения…" value={q}
          onChange={(e) => setQ(e.target.value)} />
      </div>
      {!rows && <div className="label-mono">Загружаем…</div>}
      {rows && !rows.length && (
        <div className="state-empty"><b>Никого не нашли</b><span>Поменяйте запрос</span></div>
      )}
      {rows && rows.length > 0 && (
        <table className="doc-table"><thead><tr>
          <th>Заведение</th><th>Тариф</th><th>Точек</th>
          <th style={{ textAlign: 'right' }}>MRR</th><th>Статус</th><th>Оплачено до</th>
        </tr></thead><tbody>
          {rows.map((a) => (
            <tr key={a.accountId} className={a.status === 'PAST_DUE' ? 'row-warn' : ''}>
              <td>{a.name}</td>
              <td className="adm-mini">{a.planLine ?? '—'}</td>
              <td>{a.locations}</td>
              <td className="money" style={{ textAlign: 'right' }}>{fmt(a.mrr)}</td>
              <td>{STATUS_RU[a.status] ?? a.status}</td>
              <td>{a.periodEnd ? new Date(a.periodEnd).toLocaleDateString('ru-RU') : '—'}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

// ═══════════════ БИЛЛИНГ ═══════════════

function BillingView({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/admin/billing`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, [token]);

  if (!d) return <div className="label-mono" style={{ padding: 26 }}>Считаем…</div>;

  return (
    <>
      <div className="adm-page">
        <h2>Платежи за месяц</h2>
        <div className="kpi-row">
          <div className="kpi"><span>Платежей</span><b>{d.issuedCount}</b></div>
          <div className="kpi"><span>Сумма</span><b className="money">{fmt(d.issuedSum)}</b></div>
          <div className="kpi"><span>Средний срок оплаты</span><b>{d.avgPayDays} дн.</b></div>
        </div>
        <p className="hint">{d.reminders}</p>
      </div>
      <DunningScreen amount={d.issuedSum} />
    </>
  );
}

// ═══════════════ ТИКЕТЫ ═══════════════

function TicketsView({ token }: { token: string }) {
  const [rows, setRows] = useState<Ticket[] | null>(null);

  useEffect(() => {
    fetch(`${API}/admin/tickets`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => setRows((d.rows ?? []).map((t: any): Ticket => ({
        id: t.id,
        accountId: t.accountId ?? '',
        accountName: t.clientName ?? '—',
        accountMrr: 0,
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        level: 'VENDOR',
        createdAt: new Date(t.createdAt),
        assignee: null,
      }))))
      .catch(() => setRows([]));
  }, [token]);

  if (!rows) return <div className="label-mono" style={{ padding: 26 }}>Загружаем очередь…</div>;

  return (
    <TicketsScreen tickets={rows} now={new Date()}
      onOpen={() => {}} onCreateIncident={() => {}} onEscalate={() => {}} />
  );
}

// ═══════════════ ТАРИФЫ И ФУНКЦИИ ═══════════════
// Матрица тарифов: переключение модуля сохраняется через PATCH /admin/plans/:id/modules.

function FeaturesView({ token }: { token: string }) {
  const [plans, setPlans] = useState<any[] | null>(null);
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`${API}/admin/plan-matrix`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { plans: [] }))
      .then((d) => {
        setPlans(d.plans ?? []);
        const m: Record<string, string[]> = {};
        for (const p of d.plans ?? []) m[p.code] = [...(p.modules ?? [])];
        setMatrix(m);
      })
      .catch(() => setPlans([]));
  }, [token]);

  if (!plans) return <div className="label-mono" style={{ padding: 26 }}>Загружаем тарифы…</div>;
  if (!plans.length) return (
    <div className="state-empty" style={{ padding: 40 }}>
      <b>Тарифы не заведены</b><span>Запустите сид: pnpm db:seed:plans</span>
    </div>
  );

  const allKeys = [...new Set(plans.flatMap((p) => p.modules ?? []))] as string[];
  const features = allKeys.map((k) => ({
    key: k,
    title: MODULE_RU[k]?.title ?? k,
    group: MODULE_RU[k]?.group ?? 'Прочее',
  }));

  return (
    <FeatureMatrix
      planKeys={plans.map((p) => p.code)}
      planNames={Object.fromEntries(plans.map((p) => [p.code, `${p.name} · ${fmt(p.price)}`]))}
      features={features}
      matrix={matrix}
      clientsPerPlan={Object.fromEntries(plans.map((p) => [p.code, p.clientsCount ?? 0]))}
      dirty={dirty}
      onToggle={(planKey, feature) => {
        setMatrix((m) => {
          const cur = m[planKey] ?? [];
          const next = cur.includes(feature) ? cur.filter((f) => f !== feature) : [...cur, feature];
          return { ...m, [planKey]: next };
        });
        setDirty(true);
      }}
      onSave={() => {
        Promise.all(plans.map((p) =>
          fetch(`${API}/admin/plans/${p.id}/modules`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ modules: matrix[p.code] ?? [] }),
          }),
        )).then(() => setDirty(false)).catch(() => null);
      }}
    />
  );
}

// ═══════════════ ОБОЛОЧКА ═══════════════

function Admin({ token, onOut }: { token: string; onOut: () => void }) {
  const [tab, setTab] = useState('pulse');
  const [data, setData] = useState<any>(null);
  const [tCount, setTCount] = useState(0);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`${API}/admin/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.status === 401) { onOut(); return null; } return r.ok ? r.json() : null; })
      .then((d) => d ? setData(d) : setErr(true))
      .catch(() => setErr(true));
    fetch(`${API}/admin/tickets`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => setTCount((d.rows ?? []).length)).catch(() => null);
  }, [token]);

  if (err) return (
    <div className="state-empty" style={{ padding: 40 }}>
      <b>Не удалось загрузить</b>
      <span>Проверьте связь и войдите снова</span>
      <button className="btn" style={{ marginTop: 16 }} onClick={onOut}>Выйти</button>
    </div>
  );
  if (!data) return <div style={{ padding: 40 }} className="label-mono">Загружаем…</div>;

  const accounts = data.accounts.map((a: any) => ({
    ...a,
    startedAt: new Date(a.startedAt),
    firstReceiptAt: a.firstReceiptAt ? new Date(a.firstReceiptAt) : null,
  }));
  const pastDue = accounts.filter((a: any) => a.status === 'PAST_DUE').length;

  return (
    <VendorShell
      active={tab}
      counts={{
        accounts: accounts.length,
        health: data.risks?.length ?? 0,
        tickets: tCount,
        dunning: pastDue,
        dealers: 0,
      }}
      user={{ name: 'Команда Dastarhan', role: 'Платформа' }}
      onNav={setTab}
    >
      {tab === 'pulse' && (
        <VendorPulse
          accounts={accounts}
          period={{ from: new Date(Date.now() - 30 * 86400_000), to: new Date() }}
          churnedThisPeriod={data.churned ?? 0}
          accountsAtStart={data.accountsAtStart ?? accounts.length}
          mrrPrevMonth={data.mrrPrevMonth ?? 0}
        />
      )}
      {tab === 'accounts' && <AccountsView token={token} />}
      {tab === 'health' && (
        <ClientHealth
          telemetry={(data.telemetry ?? []).map((x: any) => ({
            ...x,
            lastSeenAt: x.lastSeenAt ? new Date(x.lastSeenAt) : null,
            lastReceiptAt: x.lastReceiptAt ? new Date(x.lastReceiptAt) : null,
          }))}
          totalMrr={data.totalMrr ?? 0}
          now={new Date()}
          onCall={() => {}}
          onExport={() => {}}
        />
      )}
      {tab === 'billing' && <BillingView token={token} />}
      {tab === 'tickets' && <TicketsView token={token} />}
      {tab === 'dealers' && (
        <div className="state-empty" style={{ padding: 40 }}>
          <b>Дилеров пока нет</b>
          <span>Кабинет дилера готов и появится здесь с первым партнёром</span>
        </div>
      )}
      {tab === 'features' && <FeaturesView token={token} />}
    </VendorShell>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setToken(localStorage.getItem(TOKEN)); setReady(true); }, []);
  if (!ready) return null;
  if (!token) return <Login onIn={setToken} />;
  return <Admin token={token} onOut={() => { localStorage.removeItem(TOKEN); setToken(null); }} />;
}

createRoot(document.getElementById('root')!).render(<App />);

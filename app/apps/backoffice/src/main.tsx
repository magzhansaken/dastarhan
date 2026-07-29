// Точка входа бэк-офиса. Владелец открывает в браузере с любого устройства.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './backoffice.css';
import './platform.css';
import { Dashboard } from './screens/BackofficeScreens';
import { OnboardingWizard, ONB_STEPS } from './onboarding/OnboardingWizard';
import { ChecksScreen, AbcScreen, SalaryScreen, CashFlowScreen } from './reports/ReportScreens';
import { HallEditor } from './screens/HallEditor';
import { StaffList } from './staff/StaffScreens';
import { ReservationsScreen } from './reservations/Reservations';
import type { Reservation } from './reservations/Reservations';

const API = '/api/v1';
const TOKEN = 'dastarhan.office.token';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ ВХОД ═══════════════

function Login({ onIn }: { onIn: (t: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!r.ok) { setErr('Неверная почта или пароль'); return; }
      const d = await r.json();
      localStorage.setItem(TOKEN, d.access);
      onIn(d.access);
    } catch {
      setErr('Нет связи с сервером');
    } finally { setBusy(false); }
  };

  return (
    <div className="onb-wizard" style={{ maxWidth: 420, marginTop: 80 }}>
      <div className="label-mono">Бэк-офис</div>
      <h2>Вход для владельца</h2>
      <div className="onb-fields">
        <label>Почта
          <input className="field-lg" type="email" value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <label>Пароль
          <input className="field-lg" type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
      </div>
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>{err}</p>}
      <button className="btn btn-primary btn-lg" disabled={busy || !email || !password} onClick={submit}>
        {busy ? 'Проверяем…' : 'Войти'}
      </button>
    </div>
  );
}

// ═══════════════ СКЛАД ═══════════════

function StockView({ token }: { token: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/stock/balances`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="label-mono">Загружаем остатки…</div>;
  if (!rows.length) return (
    <div className="state-empty">
      <b>Остатков нет</b>
      <span>Проведите первую накладную — товары появятся здесь</span>
    </div>
  );

  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <>
      <header className="doc-head" style={{ padding: 0 }}>
        <div>
          <h2>Склад</h2>
          <span className="inv-note">{rows.length} позиций на {fmt(total)}</span>
        </div>
      </header>
      <table className="doc-table"><thead><tr>
        <th>Товар</th><th style={{ textAlign: 'right' }}>Остаток</th>
        <th style={{ textAlign: 'right' }}>Себестоимость</th>
        <th style={{ textAlign: 'right' }}>Сумма</th>
      </tr></thead><tbody>
        {rows.map((r) => (
          // Минус подсвечиваем: продали больше, чем оприходовали —
          // значит забыли провести накладную
          <tr key={r.productId} className={r.isNegative ? 'row-warn' : ''}>
            <td>{r.name}</td>
            <td style={{ textAlign: 'right' }}>
              {Number(r.qty).toFixed(3).replace(/\.?0+$/, '')} {r.unit === 'KG' ? 'кг' : r.unit === 'L' ? 'л' : 'шт'}
            </td>
            <td className="money" style={{ textAlign: 'right' }}>{fmt(r.avgCost)}</td>
            <td className="money" style={{ textAlign: 'right' }}>{fmt(r.value)}</td>
          </tr>
        ))}
      </tbody></table>
    </>
  );
}

// ═══════════════ ПРИБЫЛЬ ═══════════════

function ProfitView({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/finance/pnl`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setD)
      .catch(() => setD(null));
  }, [token]);

  if (!d) return <div className="label-mono">Считаем прибыль…</div>;

  return (
    <>
      <header className="doc-head" style={{ padding: 0 }}>
        <div><h2>Какая у меня прибыль?</h2>
          <span className="inv-note">За последние 30 дней</span></div>
      </header>
      <table className="pnl-table"><tbody>
        <tr><td>Выручка</td><td className="money" style={{ textAlign: 'right' }}>{fmt(d.revenue)}</td></tr>
        <tr><td>Расходы<em className="last-price">закупки, зарплата, аренда</em></td>
          <td className="money" style={{ textAlign: 'right' }}>−{fmt(d.expenses)}</td></tr>
        <tr><td>Налог {d.taxRate}% с оборота<em className="last-price">ИП на упрощённом режиме</em></td>
          <td className="money" style={{ textAlign: 'right' }}>−{fmt(d.tax)}</td></tr>
        <tr className="row-strong"><td>Чистая прибыль<em className="last-price">то, что осталось у вас</em></td>
          <td className="money" style={{ textAlign: 'right' }}>{fmt(d.net)}</td></tr>
      </tbody></table>
      <p className="hint">Маржа {d.marginPct}%. Налог считается сам — такого нет ни в одной другой системе в Казахстане.</p>
    </>
  );
}

// ═══════════════ ПЕРСОНАЛ ═══════════════
// Экран был готов, но не подключён к навигации. Список — с /staff,
// последний вход в системе пока не хранится, поэтому честное «ни разу».

function StaffView({ token }: { token: string }) {
  const [rows, setRows] = useState<any[] | null>(null);

  useEffect(() => {
    fetch(`${API}/staff`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }, [token]);

  if (!rows) return <div className="label-mono">Загружаем сотрудников…</div>;

  return (
    <StaffList now={new Date()}
      rows={rows.map((u: any) => ({
        userId: u.id,
        name: u.fullName ?? u.email ?? '—',
        phone: u.phone ?? '',
        roleName: u.isOwner ? 'Владелец' : (u.roles?.[0]?.roleName ?? 'Без роли'),
        points: (u.roles ?? []).map((r: any, i: number) => ({
          id: String(i), name: r.locationName, roleName: r.roleName,
        })),
        active: !!u.isActive,
        lastLoginAt: null,
      }))}
      onOpen={() => {}}
      onAdd={() => alert('Добавление сотрудника — в мастере настройки, шаг «Команда»')}
    />
  );
}

// ═══════════════ БРОНИ ═══════════════
// Шахматка столы × часы. Столы — с карты зала, брони — за выбранный день.

function ReservationsView({ token }: { token: string }) {
  const locationId = localStorage.getItem('dastarhan.locationId') ?? '';
  const [tables, setTables] = useState<{ id: string; name: string; seats: number }[]>([]);
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [tick, setTick] = useState(0);

  const load = () => {
    Promise.all([
      fetch(`${API}/hall/map?locationId=${locationId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`${API}/reservations?locationId=${locationId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : { rows: [] }))
        .catch(() => ({ rows: [] })),
    ]).then(([halls, res]) => {
      const ts: { id: string; name: string; seats: number }[] = [];
      for (const h of halls ?? []) for (const t of h.tables ?? []) {
        ts.push({ id: t.tableId, name: t.name, seats: t.seats });
      }
      setTables(ts);
      // Шахматке нужен tableId: брони без стола показываем на первом свободном
      setRows((res.rows ?? []).map((r: any) => ({
        id: r.id,
        tableId: r.tableId ?? ts[0]?.id ?? '',
        startAt: new Date(r.startAt),
        endAt: new Date(new Date(r.startAt).getTime() + (r.durationMin ?? 120) * 60000),
        guestPhone: r.phone ?? '',
        guestName: r.guestName ?? undefined,
        persons: r.guests ?? 2,
        status: r.status,
        depositAmount: r.prepaid || undefined,
        note: r.comment ?? undefined,
      })));
    });
  };

  useEffect(load, [token, tick]);

  const patch = (id: string, action: string) =>
    fetch(`${API}/reservations/${id}/${action}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
    }).then(() => setTick((t) => t + 1)).catch(() => null);

  if (!rows) return <div className="label-mono">Загружаем брони…</div>;
  if (!tables.length) return (
    <div className="state-empty">
      <b>Сначала расставьте столы</b>
      <span>Шахматка броней строится по карте зала</span>
    </div>
  );

  return (
    <ReservationsScreen
      day={new Date()} now={new Date()}
      tables={tables} reservations={rows}
      onSeat={(id) => patch(id, 'seat')}
      onCancel={(id) => patch(id, 'cancel')}
      onNew={(tableId, hour) => {
        const guestName = prompt('Имя гостя?');
        if (!guestName) return;
        const phone = prompt('Телефон?') ?? '';
        const guests = Number(prompt('Сколько гостей?', '2')) || 2;
        const startAt = new Date(); startAt.setHours(hour, 0, 0, 0);
        fetch(`${API}/reservations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ locationId, tableId, guestName, phone, guests, startAt: startAt.toISOString() }),
        }).then(() => setTick((t) => t + 1)).catch(() => null);
      }}
    />
  );
}

// ═══════════════ ОТЧЁТЫ ═══════════════
// Каждый отчёт отвечает на один вопрос владельца.
// Данные грузятся при открытии вкладки, а не все сразу:
// пять запросов на входе тормозят дашборд, ради которого и заходят.

function Report({ token, path, render }: {
  token: string; path: string; render: (rows: any) => React.ReactNode;
}) {
  const [rows, setRows] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    // Путь с ведущим «/» — абсолютный от корня API (отчёты живут не только в /reports)
    const url = path.startsWith('/') ? `${API}${path}` : `${API}/reports/${path}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d !== null ? setRows(d) : setErr(true))
      .catch(() => setErr(true));
  }, [token, path]);

  if (err) return (
    <div className="state-empty">
      <b>Не удалось загрузить отчёт</b>
      <span>Проверьте связь и обновите страницу</span>
    </div>
  );
  if (!rows) return <div className="label-mono">Считаем…</div>;
  if (Array.isArray(rows) && !rows.length) return (
    <div className="state-empty">
      <b>Пока нет данных</b>
      <span>Отчёт появится после первых продаж</span>
    </div>
  );
  return <>{render(rows)}</>;
}

// ═══════════════ МАСТЕР НАСТРОЙКИ ═══════════════
// Открывается сразу после регистрации: владелец обещали первый чек
// за 15 минут, значит путь не должен обрываться на пустом дашборде.

const ONB_KEY = 'dastarhan.onboarding';

function Wizard({ token, accountName, onDone }: {
  token: string; accountName: string; onDone: () => void;
}) {
  const saved = JSON.parse(localStorage.getItem(ONB_KEY) ?? '{}');
  const [done, setDone] = useState<string[]>(saved.done ?? []);
  const [active, setActive] = useState<string>(saved.active ?? ONB_STEPS[0].key);
  const [sel, setSel] = useState<any>(saved.sel ?? {});

  const save = (d: string[], a: string, s: any) => {
    localStorage.setItem(ONB_KEY, JSON.stringify({ done: d, active: a, sel: s }));
  };

  const next = () => {
    const i = ONB_STEPS.findIndex((x) => x.key === active);
    const d = done.includes(active) ? done : [...done, active];
    const a = ONB_STEPS[Math.min(i + 1, ONB_STEPS.length - 1)].key;
    setDone(d); setActive(a); save(d, a, sel);
  };

  return (
    <OnboardingWizard
      accountName={accountName}
      ownerName={JSON.parse(localStorage.getItem('dastarhan.user') ?? '{}').name ?? 'Владелец'}
      doneKeys={done}
      activeKey={active}
      selected={sel}
      onSelectBusiness={(k) => { const s = { ...sel, business: k }; setSel(s); save(done, active, s); }}
      onSelectMenuSource={(k) => { const s = { ...sel, menuSource: k }; setSel(s); save(done, active, s); }}
      onStep={(k) => { setActive(k); save(done, k, sel); }}
      onNext={next}
      onSkip={next}
      onFinish={() => {
        // Отметку о завершении храним локально: повторно мастер
        // не покажется, но владелец сможет вернуться из меню
        localStorage.setItem(ONB_KEY, JSON.stringify({ done: ONB_STEPS.map((s) => s.key), active, sel, finished: true }));
        onDone();
      }}
    />
  );
}

// ═══════════════ ОБОЛОЧКА ═══════════════

const TABS = [
  { id: 'dash', title: 'Как идут дела' },
  { id: 'checks', title: 'Чеки за день' },
  { id: 'abc', title: 'Что кормит бизнес' },
  { id: 'money', title: 'Куда ушли деньги' },
  { id: 'salary', title: 'Зарплата' },
  { id: 'staff', title: 'Сотрудники' },
  { id: 'resv', title: 'Брони' },
  { id: 'hall', title: 'Карта зала' },
  { id: 'stock', title: 'Склад' },
  { id: 'profit', title: 'Прибыль' },
  { id: 'setup', title: 'Мастер настройки' },
];

function Office({ token, onOut }: { token: string; onOut: () => void }) {
  // Новый владелец сразу попадает в мастер, а не на пустой дашборд
  const onb = JSON.parse(localStorage.getItem(ONB_KEY) ?? '{}');
  const [tab, setTab] = useState(onb.finished ? 'dash' : 'setup');
  const [dash, setDash] = useState<any>(null);
  const [hours, setHours] = useState<any>(null);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`${API}/reports/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.status === 401) { onOut(); return null; } return r.ok ? r.json() : null; })
      .then((d) => d ? setDash(d) : setErr(true))
      .catch(() => setErr(true));
  }, [token]);

  useEffect(() => {
    fetch(`${API}/reports/by-hour?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null)).then(setHours).catch(() => null);
  }, [token, period]);

  return (
    <div className="bo-layout">
      <nav className="bo-nav">
        <div className="bo-logo">Dastarhan</div>
        <div className="bo-section">
          <h4>Сегодня</h4>
          {TABS.map((t) => (
            <a key={t.id} className={`bo-task ${tab === t.id ? 'on' : ''}`}
              onClick={() => setTab(t.id)}>{t.title}</a>
          ))}
        </div>
        <div className="bo-section">
          <h4>Владелец</h4>
          <a className="bo-task" onClick={onOut}>Выйти</a>
        </div>
      </nav>
      <main style={{ padding: 26 }}>
        {tab === 'dash' && (
          err ? <div className="state-empty"><b>Не удалось загрузить</b><span>Проверьте связь</span></div>
          : dash ? <Dashboard data={{ ...dash, byHour: hours?.hours ?? [], peakHour: hours?.peakHour }}
              period={period} onPeriod={setPeriod} onReport={() => {}} />
          : <div className="label-mono">Загружаем…</div>
        )}
        {tab === 'checks' && (
          <Report token={token} path="checks"
            render={(rows) => <ChecksScreen rows={rows} periodLabel="За сегодня" />} />
        )}
        {tab === 'abc' && (
          <Report token={token} path="abc"
            render={(rows) => <AbcScreen rows={rows} periodLabel="За 30 дней" positionsCount={rows.length} />} />
        )}
        {tab === 'money' && (
          <Report token={token} path="/finance/cashflow"
            render={(d) => (
              <CashFlowScreen inflow={d.inflow ?? 0} outflow={d.outflow ?? 0}
                byCategory={d.byCategory ?? []} />
            )} />
        )}
        {tab === 'salary' && (
          <Report token={token} path="payroll"
            render={(rows) => <SalaryScreen rows={rows} periodLabel="За месяц" />} />
        )}
        {tab === 'staff' && <StaffView token={token} />}
        {tab === 'resv' && <ReservationsView token={token} />}
        {tab === 'hall' && (
          <HallEditor token={token}
            locationId={localStorage.getItem('dastarhan.locationId') ?? ''} />
        )}
        {tab === 'stock' && <StockView token={token} />}
        {tab === 'profit' && <ProfitView token={token} />}
        {tab === 'setup' && (
          <Wizard token={token} accountName={dash?.accountName ?? 'Ваше заведение'}
            onDone={() => setTab('dash')} />
        )}
      </main>
    </div>
  );
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN));
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!token) return <Login onIn={setToken} />;

  return <Office token={token} onOut={() => {
    localStorage.removeItem(TOKEN);
    setToken(null);
  }} />;
}

createRoot(document.getElementById('root')!).render(<App />);

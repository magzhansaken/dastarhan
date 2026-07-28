// Точка входа бэк-офиса. Владелец открывает в браузере с любого устройства.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './backoffice.css';
import './platform.css';
import { Dashboard } from './screens/BackofficeScreens';

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

// ═══════════════ ОБОЛОЧКА ═══════════════

const TABS = [
  { id: 'dash', title: 'Как идут дела' },
  { id: 'stock', title: 'Склад' },
  { id: 'profit', title: 'Прибыль' },
];

function Office({ token, onOut }: { token: string; onOut: () => void }) {
  const [tab, setTab] = useState('dash');
  const [dash, setDash] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`${API}/reports/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.status === 401) { onOut(); return null; } return r.ok ? r.json() : null; })
      .then((d) => d ? setDash(d) : setErr(true))
      .catch(() => setErr(true));
  }, [token]);

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
          : dash ? <Dashboard data={dash} period="day" onPeriod={() => {}} onReport={() => {}} />
          : <div className="label-mono">Загружаем…</div>
        )}
        {tab === 'stock' && <StockView token={token} />}
        {tab === 'profit' && <ProfitView token={token} />}
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

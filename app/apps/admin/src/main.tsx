// Админка платформы. Владелец Dastarhan видит здесь все заведения,
// их выручку, риск оттока и очередь поддержки.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './admin.css';
import './platform.css';
import { VendorShell } from '../../vendor/src/VendorShell';
import { VendorPulse, ClientHealth } from '../../vendor/src/VendorScreens';

const API = '/api/v1';
const TOKEN = 'dastarhan.admin.token';

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

function Admin({ token, onOut }: { token: string; onOut: () => void }) {
  const [tab, setTab] = useState('pulse');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`${API}/admin/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (r.status === 401) { onOut(); return null; } return r.ok ? r.json() : null; })
      .then((d) => d ? setData(d) : setErr(true))
      .catch(() => setErr(true));
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

  return (
    <VendorShell
      active={tab}
      counts={{ accounts: accounts.length, tickets: 0, risks: data.risks?.length ?? 0 } as any}
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

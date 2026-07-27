// Точка входа кассы.
// Два состояния: касса не активирована (вводим код от владельца)
// и активирована (вход по PIN сотрудника).
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/pos.css';
import { PinScreen } from './ui/screens/PosScreens';

// В упакованном приложении (Android через Capacitor, Windows через Tauri)
// относительных путей нет — сервер нужно указывать явно.
// Относительный путь оставляем только для разработки в браузере,
// где работает прокси Vite.
const SERVER = 'https://dastarhan.duckdns.org/api/v1';

function resolveApi(): string {
  const env = (import.meta as any).env?.VITE_API_URL;
  if (env) return env;

  const w = window as any;
  const packaged =
    !!w.Capacitor ||                      // Android
    !!w.__TAURI__ || !!w.__TAURI_INTERNALS__ ||  // Windows
    location.protocol === 'file:' ||
    location.protocol === 'tauri:' ||
    location.hostname === 'tauri.localhost';

  // Дев-режим Vite: порт 5173/5174 и обычный http
  const dev = location.port === '5173' || location.port === '5174';

  return packaged || !dev ? SERVER : '/api/v1';
}

const API = resolveApi();

const KEY = 'dastarhan.deviceKey';
const LIC = 'dastarhan.license';

function Activation({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activate = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API}/terminals/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      if (!r.ok) { setErr('Код не подошёл. Проверьте и введите снова.'); return; }
      const data = await r.json();
      localStorage.setItem(KEY, data.deviceKey);
      localStorage.setItem(LIC, JSON.stringify(data.license));
      localStorage.setItem('dastarhan.place', data.locationName ?? '');
      onDone();
    } catch {
      setErr('Нет связи с сервером. Проверьте интернет.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pin-screen">
      <div className="label-mono">Активация кассы</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em' }}>
        Введите код из бэк-офиса
      </h2>
      <p className="hint" style={{ maxWidth: 320 }}>
        Владелец создаёт кассу в разделе «Настройки» и получает код вида DSTR-XXXX-XXXX.
      </p>
      <input
        className="search"
        style={{ width: 300, textAlign: 'center', fontSize: 20, letterSpacing: 2, height: 60 }}
        placeholder="DSTR-XXXX-XXXX"
        value={code}
        autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)}
      />
      {err && <div className="pin-error">{err}</div>}
      <button className="btn btn-accent" style={{ width: 300 }} disabled={busy || code.length < 10}
        onClick={activate}>
        {busy ? 'Проверяем…' : 'Активировать'}
      </button>
      <p className="hint" style={{ fontSize: 12, opacity: .6 }}>{API}</p>
    </div>
  );
}

function App() {
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDeviceKey(localStorage.getItem(KEY));
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!deviceKey) {
    return <Activation onDone={() => setDeviceKey(localStorage.getItem(KEY))} />;
  }

  return (
    <PinScreen onSubmit={async (pin) => {
      try {
        const r = await fetch(`${API}/auth/pos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceKey, pin }),
        });
        if (!r.ok) return false;
        const data = await r.json();
        localStorage.setItem('dastarhan.token', data.token);
        localStorage.setItem('dastarhan.user', JSON.stringify(data.user));
        // Пока экран заказа не подключён к API — показываем, кто вошёл
        alert(`Вход выполнен: ${data.user.name}, ${data.user.role}`);
        return true;
      } catch {
        return false;
      }
    }} />
  );
}

createRoot(document.getElementById('root')!).render(<App />);

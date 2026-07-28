// QR-меню гостя. Открывается по ссылке со стола, авторизации нет.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './guest.css';
import { GuestMenuPage, buildTableOrder } from './GuestMenu';

const API = '/api/v1';

function App() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  // Токен стола в адресе: /?t=cms3cze... — гость сканирует QR
  const token = new URLSearchParams(location.search).get('t') ?? '';

  useEffect(() => {
    if (!token) { setErr('Отсканируйте QR-код со стола'); return; }
    fetch(`${API}/guest/menu/${token}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d ? setData(d) : setErr('Стол не найден'))
      .catch(() => setErr('Нет связи'));
  }, [token]);

  if (err) return <div className="state-empty" style={{ padding: 40 }}><b>{err}</b></div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>Загружаем меню…</div>;

  return (
    <GuestMenuPage
      shopName={data.shopName}
      tableName={data.tableName}
      tableToken={data.tableToken}
      categories={data.categories}
      items={data.items}
      selfOrderEnabled={false}
      onSubmitOrder={() => {}}
      onCallWaiter={() => {
        fetch(`${API}/guest/call-waiter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableToken: token }),
        }).catch(() => null);
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);

// Экран кухни. Планшет на стене, повар смотрит на него издалека
// и касается мокрыми руками — крупные цели, минимум текста.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './kds.css';
import { KdsScreen } from './KdsScreen';

const API = '/api/v1';
const TOKEN = 'dastarhan.token';

function App() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [now, setNow] = useState(new Date());
  const [err, setErr] = useState<string | null>(null);

  const token = localStorage.getItem(TOKEN) ?? '';
  const locationId = localStorage.getItem('dastarhan.locationId') ?? '';

  const load = async () => {
    try {
      const r = await fetch(`${API}/kds/tickets?locationId=${locationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setErr('Нет связи с сервером'); return; }
      setTickets(await r.json());
      setErr(null);
    } catch { setErr('Нет связи с сервером'); }
  };

  useEffect(() => {
    load();
    // Обновление раз в 10 секунд: новый заказ должен появиться
    // на кухне сам, повар не нажимает «обновить»
    const t = setInterval(load, 10_000);
    const c = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  const setStatus = async (itemId: string, status: 'COOKING' | 'READY') => {
    await fetch(`${API}/kds/item-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ itemId, status }),
    }).catch(() => null);
    load();
  };

  if (err) return (
    <div className="state-empty" style={{ padding: 40 }}>
      <b>{err}</b>
      <span>Заказы появятся, когда связь вернётся</span>
    </div>
  );

  return (
    <KdsScreen
      tickets={tickets.map((t) => ({
        orderId: t.orderId, number: t.number, tableName: t.tableName,
        mode: t.mode, openedAt: new Date(t.openedAt),
        items: t.items.map((i: any) => ({
          itemId: i.itemId, name: i.name, qty: i.qty,
          comment: i.comment, status: i.status,
        })),
      }))}
      stations={[{ id: 'all', name: 'Все цеха' }]}
      now={now}
      onStart={(id) => setStatus(id, 'COOKING')}
      onCooked={(id) => setStatus(id, 'READY')}
      onTicketDone={(orderId) => {
        const t = tickets.find((x) => x.orderId === orderId);
        t?.items.forEach((i: any) => setStatus(i.itemId, 'READY'));
      }}
      onRecall={(id) => setStatus(id, 'COOKING')}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);

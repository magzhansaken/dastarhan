// Точка входа кассы.
// Три состояния: активация по коду → вход по PIN → рабочий экран заказа.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/pos.css';
import { PinScreen, OrderScreen, PaymentScreen } from './ui/screens/PosScreens';
import { reduceOrder, orderTotals } from '../../../packages/shared/src/order/orderReducer';
import type { OrderState } from '../../../packages/shared/src/order/orderReducer';

// В упакованном приложении (Android через Capacitor, Windows через Tauri)
// относительных путей нет — сервер указывается явно.
const SERVER = 'https://dastarhan.duckdns.org/api/v1';

function resolveApi(): string {
  const env = (import.meta as any).env?.VITE_API_URL;
  if (env) return env;
  const w = window as any;
  const packaged = !!w.Capacitor || !!w.__TAURI__ || !!w.__TAURI_INTERNALS__
    || location.protocol === 'file:' || location.protocol === 'tauri:'
    || location.hostname === 'tauri.localhost';
  const dev = location.port === '5173' || location.port === '5174';
  return packaged || !dev ? SERVER : '/api/v1';
}

const API = resolveApi();
const KEY = 'dastarhan.deviceKey';
const TOKEN = 'dastarhan.token';

// ═══════════════ АКТИВАЦИЯ ═══════════════

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
      const d = await r.json();
      localStorage.setItem(KEY, d.deviceKey);
      localStorage.setItem('dastarhan.place', d.locationName ?? '');
      localStorage.setItem('dastarhan.locationId', d.locationId ?? '');
      localStorage.setItem('dastarhan.license', JSON.stringify(d.license ?? {}));
      onDone();
    } catch {
      setErr('Нет связи с сервером. Проверьте интернет.');
    } finally { setBusy(false); }
  };

  return (
    <div className="pin-screen">
      <div className="label-mono">Активация кассы</div>
      <h2 style={{ fontSize: 24, fontWeight: 700 }}>Введите код из бэк-офиса</h2>
      <p className="hint" style={{ maxWidth: 320 }}>
        Владелец создаёт кассу в настройках и получает код вида DSTR-XXXX-XXXX.
      </p>
      <input className="search" style={{ width: 300, textAlign: 'center', fontSize: 20, height: 60 }}
        placeholder="DSTR-XXXX-XXXX" value={code} autoCapitalize="characters"
        onChange={(e) => setCode(e.target.value)} />
      {err && <div className="pin-error">{err}</div>}
      <button className="btn btn-accent" style={{ width: 300 }}
        disabled={busy || code.length < 10} onClick={activate}>
        {busy ? 'Проверяем…' : 'Активировать'}
      </button>
      <p className="hint" style={{ fontSize: 12, opacity: .55 }}>{API}</p>
    </div>
  );
}

// ═══════════════ РАБОЧИЙ ЭКРАН ═══════════════

function Pos({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [catalog, setCatalog] = useState<any>({ categories: [], products: [] });
  const [stops, setStops] = useState<Record<string, number | null>>({});
  const [order, setOrder] = useState<OrderState | null>(null);
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const locationId = localStorage.getItem('dastarhan.locationId') ?? '';
  const place = localStorage.getItem('dastarhan.place') ?? '';
  const user = JSON.parse(localStorage.getItem('dastarhan.user') ?? '{}');

  useEffect(() => {
    (async () => {
      try {
        const h = { Authorization: `Bearer ${token}` };
        const [c, s] = await Promise.all([
          fetch(`${API}/menu/catalog?locationId=${locationId}`, { headers: h }).then((r) => r.json()),
          fetch(`${API}/menu/stop-list?locationId=${locationId}`, { headers: h })
            .then((r) => (r.ok ? r.json() : [])).catch(() => []),
        ]);
        setCatalog(c);
        const m: Record<string, number | null> = {};
        for (const x of s ?? []) m[x.productId] = x.remaining;
        setStops(m);
        // Заказ открывается сразу: у стойки лишний экран «создать заказ» —
        // это лишнее касание, которого не должно быть
        setOrder(reduceOrder(null, {
          type: 'order.opened', orderId: crypto.randomUUID(),
          number: Math.floor(Date.now() / 1000) % 10000, mode: 'DINE_IN',
        } as any));
      } catch {
        setErr('Не удалось загрузить меню');
      } finally { setLoading(false); }
    })();
  }, [token, locationId]);

  if (loading) return <div className="pin-screen"><div className="label-mono">Загружаем меню…</div></div>;
  if (err) return (
    <div className="pin-screen">
      <div className="state-empty"><b>{err}</b><span>Проверьте связь и войдите снова</span></div>
      <button className="btn" onClick={onLogout}>Выйти</button>
    </div>
  );

  const products = catalog.products.map((p: any) => ({
    productId: p.productId, name: p.name, price: p.price,
    categoryId: p.categoryId,
    stop: p.productId in stops ? { remaining: stops[p.productId] } : undefined,
  }));

  if (paying && order) {
    const t = orderTotals(order);
    return (
      <PaymentScreen due={t.subtotal} orderNumber={order.number}
        cashierName={user.name} subtotal={t.subtotal} fiscal="ok"
        methods={[
          { id: 'cash', name: 'Наличные', kind: 'CASH' },
          { id: 'kaspi', name: 'Kaspi QR', kind: 'KASPI_QR' },
          { id: 'card', name: 'Карта', kind: 'CARD' },
        ]}
        onBack={() => setPaying(false)}
        onConfirm={() => {
          // Новый заказ сразу после оплаты: кассир не ждёт
          setOrder(reduceOrder(null, {
            type: 'order.opened', orderId: crypto.randomUUID(),
            number: Math.floor(Date.now() / 1000) % 10000, mode: 'DINE_IN',
          } as any));
          setPaying(false);
        }} />
    );
  }

  return (
    <OrderScreen
      order={order!}
      catalog={products}
      categories={catalog.categories.map((c: any) => ({ id: c.id, name: c.name, color: c.color }))}
      online={true} unsyncedCount={0} fiscal="ok"
      cashierName={user.name} tableName={place}
      onAdd={(p) => setOrder((o) => reduceOrder(o, {
        type: 'order.item.added', orderId: o!.orderId, itemId: crypto.randomUUID(),
        productId: p.productId, name: p.name, guestNo: 1, qty: 1,
        unitPrice: p.price, modifiers: [],
      } as any))}
      onItemTap={(itemId) => setOrder((o) => reduceOrder(o, {
        type: 'order.item.removed', orderId: o!.orderId, itemId,
        reason: 'BEFORE_KITCHEN', byUserId: user.id ?? 'pos',
      } as any))}
      onPay={() => setPaying(true)}
      onHall={onLogout}
    />
  );
}

// ═══════════════ КОРЕНЬ ═══════════════

function App() {
  const [deviceKey, setDeviceKey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDeviceKey(localStorage.getItem(KEY));
    setToken(localStorage.getItem(TOKEN));
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!deviceKey) return <Activation onDone={() => setDeviceKey(localStorage.getItem(KEY))} />;

  if (!token) {
    return (
      <PinScreen onSubmit={async (pin) => {
        try {
          const r = await fetch(`${API}/auth/pos`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceKey, pin }),
          });
          if (!r.ok) return false;
          const d = await r.json();
          localStorage.setItem(TOKEN, d.token);
          localStorage.setItem('dastarhan.user', JSON.stringify(d.user));
          setToken(d.token);
          return true;
        } catch { return false; }
      }} />
    );
  }

  return <Pos token={token} onLogout={() => {
    localStorage.removeItem(TOKEN);
    setToken(null);
  }} />;
}

createRoot(document.getElementById('root')!).render(<App />);

// Приложение курьера. Телефон, одна рука, на бегу — крупные кнопки
// и постоянно видимый долг наличных.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './courier.css';
import { CourierApp } from './CourierApp';

const API = '/api/v1';
const TOKEN = 'dastarhan.token';

function App() {
  const [trip, setTrip] = useState<any>(null);
  const [now, setNow] = useState(new Date());
  const [online, setOnline] = useState(navigator.onLine);

  const token = localStorage.getItem(TOKEN) ?? '';
  const courierId = localStorage.getItem('dastarhan.courierId') ?? '';

  const load = () => {
    fetch(`${API}/delivery/trip?courierId=${courierId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setTrip(d); setOnline(true); })
      .catch(() => setOnline(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    const c = setInterval(() => setNow(new Date()), 30_000);
    // Курьер теряет связь в лифтах и подвалах — состояние сети
    // показываем честно, чтобы он понимал, почему не обновляется
    const on = () => { setOnline(true); load(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(t); clearInterval(c);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!trip?.active) return (
    <div className="state-empty" style={{ padding: 40 }}>
      <b>Рейс закрыт</b>
      <span>Все заказы вручены и наличные сданы. Новый рейс придёт сюда сам</span>
    </div>
  );

  const post = (path: string, body: any) =>
    fetch(`${API}/delivery/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then(load).catch(() => setOnline(false));

  return (
    <CourierApp
      courierName={localStorage.getItem('dastarhan.courierName') ?? 'Курьер'}
      orders={trip.orders.map((o: any) => ({
        orderId: o.orderId,
        number: o.number ?? 0,
        address: o.address ?? '',
        phone: o.phone ?? '',
        items: o.items ?? [],
        // Ноль означает предоплату Kaspi: у двери денег не берём
        cashDue: o.total ?? 0,
        comment: o.comment ?? undefined,
        customerName: o.customerName ?? undefined,
        promisedAt: o.promisedAt ? new Date(o.promisedAt) : new Date(),
        status: (o.status === 'CLOSED' ? 'DELIVERED'
          : o.status === 'CANCELLED' ? 'RETURNED' : 'DISPATCHED') as
          'DISPATCHED' | 'DELIVERED' | 'RETURNED',
      }))}
      trip={{
        courierId,
        orders: trip.orders.map((o: any) => ({
          orderId: o.orderId,
          status: (o.status === 'CLOSED' ? 'DELIVERED'
            : o.status === 'CANCELLED' ? 'RETURNED' : 'DISPATCHED') as any,
          cashDue: o.total ?? 0,
        })),
        cashCollected: trip.cashCollected,
        cashReturned: trip.cashReturned,
        closed: false,
      }}
      now={now}
      online={online}
      onDelivered={(orderId) => post('delivered', { orderId, cashTaken: 0 })}
      onReturned={(orderId, reason) => post('returned', { orderId, reason })}
      onHandOverCash={() => post('handover', { tripId: trip.tripId, amount: trip.cashDebt })}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);

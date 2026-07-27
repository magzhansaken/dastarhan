// Точка входа бэк-офиса.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './backoffice.css';
import './platform.css';
import { Dashboard } from './screens/BackofficeScreens';

const DEMO = {
  todayRevenue: 48620000, yesterdaySameTime: 43250000,
  checks: 142, avgCheck: 342400,
  alerts: [{ severity: 'HIGH' as const, text: 'Конина заканчивается — остаток 1,2 кг' }],
  unsyncedTerminals: 0,
};

function App() {
  const [data, setData] = useState(DEMO);
  const [live, setLive] = useState(false);
  useEffect(() => {
    fetch('/api/v1/reports/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setData(d); setLive(true); } })
      .catch(() => {});
  }, []);
  return (
    <>
      {!live && (
        <div style={{ background: '#fdf6e3', color: '#b97f14', padding: '10px 26px', fontSize: 14 }}>
          Демо-данные: API недоступен. Запустите <code>pnpm dev:api</code>.
        </div>
      )}
      <Dashboard data={data} period="day" onPeriod={() => {}} shiftInfo="Айгерим" onReport={() => {}} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

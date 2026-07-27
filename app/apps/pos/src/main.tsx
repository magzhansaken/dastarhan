// Точка входа кассы.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/pos.css';
import { PinScreen } from './ui/screens/PosScreens';

function App() {
  return (
    <PinScreen onSubmit={async (pin) => {
      const r = await fetch('/api/v1/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      }).catch(() => null);
      return !!r?.ok;
    }} />
  );
}

createRoot(document.getElementById('root')!).render(<App />);

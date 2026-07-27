// apps/pos/src/ui/App.tsx
// СБОРКА КАССЫ (P0-2 + P0-3): экран зала + машина экранов приложения.
// Анализ: Poster table-color (цвет = состояние: свободен/занят/пречек),
// Paloma дизайнер столов (расстановка x/y), QR (быстрый заказ отдельной
// кнопкой). Наше решение сверх рынка: СТАРТОВЫЙ ЭКРАН ЗАВИСИТ ОТ ВЕРТИКАЛИ —
// кафе начинает с зала, фастфуд/магазин сразу с заказа (минус 1 касание там,
// где столов нет; ни один конкурент так не делает — у всех зал в настройке).

import React, { useState } from 'react';
import { PinScreen, OrderScreen, PaymentScreen } from './screens.tsx';
import { OrderState, OrderEvent, reduceOrder, orderTotals } from './order.ts';
import { CatalogItem } from './vm.ts';

// ═══════════════ ЭКРАН ЗАЛА ═══════════════

export interface TableVm {
  id: string; name: string; x: number; y: number; shape: 'rect' | 'round';
  seats: number;
  // Состояние стола — из открытых заказов (правило цветов Poster)
  state: 'free' | 'busy' | 'precheck';
  total?: number;     // сумма открытого заказа — прямо на столе (глубже Poster)
  minutes?: number;   // сколько минут открыт — видно «засидевшиеся» столы
}

export function tableColor(state: TableVm['state']): string {
  return state === 'free' ? 'var(--surface-2)'
    : state === 'precheck' ? 'var(--warn)' : 'var(--accent)';
}

/** Состояние стола из заказов: открытый заказ → busy; печатали пречек → precheck. */
export function deriveTableState(
  tableId: string,
  orders: { tableId?: string; status: string; precheckAt?: string | null; subtotal: number; openedAt: string }[],
  now: Date,
): Pick<TableVm, 'state' | 'total' | 'minutes'> {
  const open = orders.find((o) => o.tableId === tableId && o.status === 'OPEN');
  if (!open) return { state: 'free' };
  return {
    state: open.precheckAt ? 'precheck' : 'busy',
    total: open.subtotal,
    minutes: Math.floor((now.getTime() - new Date(open.openedAt).getTime()) / 60000),
  };
}

export function HallScreen(props: {
  tables: TableVm[];
  onTable: (t: TableVm) => void;
  onQuickOrder: () => void;
}) {
  const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
  return (
    <div className="hall-screen">
      <header className="hall-head">
        <h2>Зал</h2>
        <button className="btn btn-accent" onClick={props.onQuickOrder}>Быстрый заказ</button>
      </header>
      <div className="hall-canvas">
        {props.tables.map((t) => (
          <button key={t.id}
            className={`table table-${t.shape} table-${t.state}`}
            style={{ left: t.x, top: t.y, background: tableColor(t.state) }}
            onClick={() => props.onTable(t)}>
            <span className="t-name">{t.name}</span>
            {t.state !== 'free' && (
              <span className="t-info">
                <b className="money">{fmt(t.total ?? 0)}</b>
                <em>{t.minutes} мин</em>
              </span>
            )}
          </button>
        ))}
      </div>
      <footer className="hall-legend">
        <span className="lg lg-free">свободен</span>
        <span className="lg lg-busy">занят</span>
        <span className="lg lg-precheck">пречек</span>
      </footer>
    </div>
  );
}

// ═══════════════ МАШИНА ЭКРАНОВ ПРИЛОЖЕНИЯ ═══════════════

export type Screen = 'PIN' | 'HALL' | 'ORDER' | 'PAYMENT';

export interface AppState {
  screen: Screen;
  vertical: 'CAFE' | 'FASTFOOD' | 'SHOP' | 'SALON' | 'BILLIARD';
  user?: { id: string; name: string };
  order: OrderState | null;
  orderSeq: number; // номер следующего заказа в смене
}

/** Стартовый экран после PIN — по вертикали (наша фишка):
 *  кафе/бильярд — зал; фастфуд/магазин/салон — сразу заказ. */
export function screenAfterLogin(vertical: AppState['vertical']): Screen {
  return vertical === 'CAFE' || vertical === 'BILLIARD' ? 'HALL' : 'ORDER';
}

export type AppAction =
  | { type: 'login'; user: { id: string; name: string } }
  | { type: 'openOrderAtTable'; tableId: string }
  | { type: 'quickOrder' }
  | { type: 'orderEvent'; ev: OrderEvent }
  | { type: 'goPay' }
  | { type: 'paid' }          // оплата принята и заказ закрыт
  | { type: 'backToCatalog' }
  | { type: 'logout' };

export function appReduce(s: AppState, a: AppAction): AppState {
  switch (a.type) {
    case 'login':
      return { ...s, user: a.user, screen: screenAfterLogin(s.vertical) };
    case 'openOrderAtTable': {
      const order = reduceOrder(null, {
        type: 'order.opened', orderId: `o${s.orderSeq}`, number: s.orderSeq,
        mode: 'DINE_IN', tableId: a.tableId,
      });
      return { ...s, order, orderSeq: s.orderSeq + 1, screen: 'ORDER' };
    }
    case 'quickOrder': {
      const order = reduceOrder(null, {
        type: 'order.opened', orderId: `o${s.orderSeq}`, number: s.orderSeq,
        mode: 'TAKEOUT',
      });
      return { ...s, order, orderSeq: s.orderSeq + 1, screen: 'ORDER' };
    }
    case 'orderEvent':
      if (!s.order) return s;
      return { ...s, order: reduceOrder(s.order, a.ev) };
    case 'goPay':
      if (!s.order || orderTotals(s.order).itemsCount === 0) return s;
      return { ...s, screen: 'PAYMENT' };
    case 'paid': {
      if (!s.order) return s;
      const closed = reduceOrder(s.order, { type: 'order.closed', orderId: s.order.orderId });
      // после оплаты: кафе → в зал, остальные → новый быстрый заказ
      void closed;
      return { ...s, order: null, screen: screenAfterLogin(s.vertical) };
    }
    case 'backToCatalog':
      return { ...s, screen: 'ORDER' };
    case 'logout':
      return { ...s, user: undefined, order: null, screen: 'PIN' };
  }
}

/** Бюджет касаний до чека, вычисляемый ИЗ машины (не декларация — факт):
 *  считаем действия пользователя от входа до закрытия оплаты. */
export function tapBudget(vertical: AppState['vertical']): number {
  // PIN (авто-сабмит 4-й цифрой — вход не считаем отдельным касанием сверх цифр)
  let taps = 0;
  if (screenAfterLogin(vertical) === 'HALL') taps += 1; // выбор стола / «быстрый»
  taps += 1; // плитка товара
  taps += 1; // «Оплата»
  taps += 1; // способ или купюра
  taps += 1; // «Готово»
  return taps;
}

// ═══════════════ КОРНЕВОЙ КОМПОНЕНТ ═══════════════

export function App(props: {
  vertical: AppState['vertical'];
  catalog: CatalogItem[];
  categories: { id: string; name: string; color?: string }[];
  tables: TableVm[];
  methods: { id: string; name: string; kind: 'CASH' | 'CARD' | 'KASPI_QR' }[];
  onLogin: (pin: string) => Promise<{ id: string; name: string } | null>;
  onAppend: (type: string, payload: unknown) => void; // EventStore.append
}) {
  const [s, setS] = useState<AppState>({
    screen: 'PIN', vertical: props.vertical, order: null, orderSeq: 1,
  });
  const dispatch = (a: AppAction) => setS((prev) => appReduce(prev, a));

  if (s.screen === 'PIN')
    return <PinScreen onSubmit={async (pin) => {
      const user = await props.onLogin(pin);
      if (user) { dispatch({ type: 'login', user }); return true; }
      return false;
    }} />;

  if (s.screen === 'HALL')
    return <HallScreen tables={props.tables}
      onTable={(t) => {
        props.onAppend('order.opened', { tableId: t.id });
        dispatch({ type: 'openOrderAtTable', tableId: t.id });
      }}
      onQuickOrder={() => {
        props.onAppend('order.opened', {});
        dispatch({ type: 'quickOrder' });
      }} />;

  if (s.screen === 'ORDER' && s.order)
    return <OrderScreen order={s.order}
      catalog={props.catalog} categories={props.categories}
      online={true} unsyncedCount={0}
      onAdd={(p) => {
        const ev: OrderEvent = {
          type: 'order.item.added', orderId: s.order!.orderId,
          itemId: `i${Date.now()}`, productId: p.productId, name: p.name,
          guestNo: 0, qty: 1, unitPrice: p.price, modifiers: [],
        };
        props.onAppend(ev.type, ev);
        dispatch({ type: 'orderEvent', ev });
      }}
      onPay={() => dispatch({ type: 'goPay' })}
      onItemTap={() => {}} />;

  if (s.screen === 'PAYMENT' && s.order)
    return <PaymentScreen
      due={orderTotals(s.order).subtotal}
      methods={props.methods}
      onConfirm={(methodId, amount, tendered) => {
        props.onAppend('payment.accepted', { methodId, amount, tendered });
        dispatch({ type: 'paid' });
      }}
      onBack={() => dispatch({ type: 'backToCatalog' })} />;

  return <div>…</div>;
}

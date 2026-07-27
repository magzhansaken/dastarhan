// apps/courier/src/CourierApp.tsx
// Экран курьера — дозакрытие роли COURIER до 100%.
// Анализ: Poster («назначить курьера и доставить заказ» — курьер видит заказ,
// отмечает доставку), r_keeper Delivery (курьеры на карте, РАСЧЁТ С КУРЬЕРОМ —
// наличные = долг до сдачи; сама статья CourierApp закрыта логином — контур
// восстановлен из смежных). Вся денежная логика уже готова и оттестирована
// в Этапе 7 (Trip, markDelivered, courierDebt, returnCash — 32 теста).
// Наши профи-добавки сверх рынка:
//  1) ДОЛГ НАЛИЧНЫХ ЖИВЬЁМ В ШАПКЕ — курьер всегда знает, сколько сдавать
//     (у r_keeper это отчёт в бэк-офисе, курьер не видит)
//  2) «Позвонить» и «Навигатор 2GIS» в одно касание (2GIS — стандарт КЗ;
//     фолбэк на geo:) — deep links прямо из карточки
//  3) приём наличных: сумма ОГРОМНАЯ + «сдача с 10 000» подсказкой — курьер
//     считает сдачу у двери, темно и неудобно
//  4) «Не вручено» с причиной → RETURNED (звонил — не отвечает) — честный
//     возврат вместо зависшего заказа
import React, { useState } from 'react';
import { courierDebt, markDelivered } from './del.ts';
import type { Trip } from './del.ts';

export type Money = number;
const fmt = (t: Money) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ VIEW-MODEL ═══════════════

export interface CourierOrderVm {
  orderId: string; number: number;
  address: string; phone: string;
  customerName?: string;
  items: { name: string; qty: number }[];
  cashDue: Money;                 // 0 = предоплачен (Kaspi)
  comment?: string;
  promisedAt: Date;
  status: 'DISPATCHED' | 'DELIVERED' | 'RETURNED';
}

/** Deep-links КЗ: звонок и навигатор (2GIS — стандарт; geo: — фолбэк). */
export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
export function navLink(address: string, lat?: number, lng?: number): string {
  if (lat != null && lng != null) return `dgis://2gis.ru/routeSearch/to/${lng},${lat}`;
  return `https://2gis.kz/search/${encodeURIComponent(address)}`;
}

/** Просрочка вручения для бейджа (isOverdue Этапа 7 в мобильной подаче). */
export function lateBadge(promisedAt: Date, now: Date): string | null {
  const min = Math.floor((now.getTime() - promisedAt.getTime()) / 60000);
  return min > 0 ? `опоздание ${min} мин` : null;
}

/** Сводка рейса для шапки: осталось вручить, наличных собрано/сдать. */
export function tripSummary(orders: CourierOrderVm[], trip: Trip) {
  return {
    toDeliver: orders.filter((o) => o.status === 'DISPATCHED').length,
    delivered: orders.filter((o) => o.status === 'DELIVERED').length,
    cashDebt: courierDebt(trip),
    cashOrdersLeft: orders.filter((o) => o.status === 'DISPATCHED' && o.cashDue > 0).length,
  };
}

/** Подсказки сдачи у двери: с 5000 / с 10000 / с 20000 (номиналы КЗ). */
export function doorChangeHints(cashDue: Money): { note: Money; change: Money }[] {
  return [5000_00, 10000_00, 20000_00]
    .filter((n) => n > cashDue)
    .map((n) => ({ note: n, change: n - cashDue }))
    .slice(0, 3);
}

export const RETURN_REASONS = [
  'Не отвечает на звонки',
  'Неверный адрес',
  'Отказался от заказа',
  'Не вышел / не открыл',
] as const;

// ═══════════════ ЭКРАН ═══════════════

export function CourierApp(props: {
  courierName: string;
  orders: CourierOrderVm[];
  trip: Trip;
  now: Date;
  online: boolean;
  onDelivered: (orderId: string) => void;       // → markDelivered (Этап 7)
  onReturned: (orderId: string, reason: string) => void;
  onHandOverCash: () => void;                    // сдача наличных на кассе
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [cashFor, setCashFor] = useState<CourierOrderVm | null>(null);
  const [returnFor, setReturnFor] = useState<CourierOrderVm | null>(null);
  const s = tripSummary(props.orders, props.trip);

  // ── приём наличных у двери ──
  if (cashFor) {
    const hints = doorChangeHints(cashFor.cashDue);
    return (
      <div className="cr-page cr-cash">
        <p className="cr-cash-label">Возьмите наличными</p>
        <b className="cr-cash-sum money">{fmt(cashFor.cashDue)}</b>
        <ul className="cr-hints">
          {hints.map((h, i) => (
            <li key={i}>с {fmt(h.note)} — сдача <b>{fmt(h.change)}</b></li>
          ))}
        </ul>
        <button className="btn btn-ok cr-big" onClick={() => {
          props.onDelivered(cashFor.orderId); setCashFor(null); setOpenId(null);
        }}>Деньги получил — вручено</button>
        <button className="btn cr-big" onClick={() => setCashFor(null)}>Назад</button>
      </div>
    );
  }

  // ── возврат с причиной ──
  if (returnFor) {
    return (
      <div className="cr-page cr-return">
        <h2>Заказ №{returnFor.number} — не вручён</h2>
        <p className="cr-dim">Выберите причину:</p>
        {RETURN_REASONS.map((r) => (
          <button key={r} className="btn cr-big" onClick={() => {
            props.onReturned(returnFor.orderId, r); setReturnFor(null); setOpenId(null);
          }}>{r}</button>
        ))}
        <button className="btn cr-big cr-back" onClick={() => setReturnFor(null)}>Назад</button>
      </div>
    );
  }

  return (
    <div className="cr-page">
      <header className="cr-head">
        <div>
          <b>{props.courierName}</b>
          <span className={`cr-net ${props.online ? 'on' : 'off'}`}>
            {props.online ? 'В сети' : 'Офлайн — данные сохранятся'}
          </span>
        </div>
        <div className="cr-debt">
          <span>Наличных у меня</span>
          <b className="money">{fmt(s.cashDebt)}</b>
        </div>
      </header>

      <div className="cr-progress">
        Вручить: <b>{s.toDeliver}</b> · Вручено: <b>{s.delivered}</b>
        {s.cashOrdersLeft > 0 && <span className="cr-cashleft"> · наличными ещё {s.cashOrdersLeft}</span>}
      </div>

      <ul className="cr-orders">
        {props.orders.map((o) => {
          const late = lateBadge(o.promisedAt, props.now);
          const open = openId === o.orderId;
          return (
            <li key={o.orderId} className={`cr-order cr-${o.status.toLowerCase()}`}>
              <button className="cr-order-head" onClick={() => setOpenId(open ? null : o.orderId)}>
                <b>№{o.number}</b>
                <span className="cr-addr">{o.address}</span>
                {o.cashDue > 0
                  ? <span className="cr-cash-badge money">{fmt(o.cashDue)} 💵</span>
                  : <span className="cr-paid-badge">оплачен ✓</span>}
                {late && o.status === 'DISPATCHED' && <span className="cr-late">{late}</span>}
                {o.status === 'DELIVERED' && <span className="cr-done">✓ вручено</span>}
                {o.status === 'RETURNED' && <span className="cr-ret">возврат</span>}
              </button>
              {open && o.status === 'DISPATCHED' && (
                <div className="cr-detail">
                  {o.customerName && <p className="cr-guest">{o.customerName}</p>}
                  <ul className="cr-items">
                    {o.items.map((i, k) => <li key={k}>{i.name} ×{i.qty}</li>)}
                  </ul>
                  {o.comment && <p className="cr-comment">💬 {o.comment}</p>}
                  <div className="cr-actions">
                    <a className="btn cr-act" href={telLink(o.phone)}>📞 Позвонить</a>
                    <a className="btn cr-act" href={navLink(o.address)}>🧭 Навигатор</a>
                  </div>
                  <button className="btn btn-ok cr-big" onClick={() =>
                    o.cashDue > 0 ? setCashFor(o) : props.onDelivered(o.orderId)}>
                    {o.cashDue > 0 ? `Вручить — взять ${fmt(o.cashDue)}` : 'Вручено'}
                  </button>
                  <button className="btn cr-big cr-back" onClick={() => setReturnFor(o)}>Не вручено…</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {s.toDeliver === 0 && s.cashDebt > 0 && (
        <footer className="cr-foot">
          <button className="btn btn-accent cr-big" onClick={props.onHandOverCash}>
            Сдать {fmt(s.cashDebt)} на кассу — закрыть рейс
          </button>
        </footer>
      )}
    </div>
  );
}

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
import { courierDebt, markDelivered } from '@dastarhan/shared/delivery/delivery.logic';
import type { Trip } from '@dastarhan/shared/delivery/delivery.logic';

export type Money = number;
const fmt = (t: Money) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ VIEW-MODEL ═══════════════

export interface CourierOrderVm {
  orderId: string; number: number;
  address: string; phone: string;
  customerName?: string;
  items: { name: string; qty: number }[];
  cashDue: Money;                 // 0 = предоплачен (Kaspi)
  etaMinutes?: number;            // «12 мин» — из макета
  distanceKm?: number;            // «2,4 км» — из макета
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

// Причины возврата — ТОЧНО из макета «Курьер — Рейс» Claude Design:
// у каждой причины есть пояснение, которое уходит менеджеру вместе с возвратом.
export const RETURN_REASONS = [
  { key: 'no_answer', title: 'Гость не отвечает', hint: 'звонил 3 раза, ждал 10 минут' },
  { key: 'no_address', title: 'Адрес не найден', hint: 'дома нет, домофон не работает' },
  { key: 'refused', title: 'Отказался забирать', hint: 'у гостя нет наличных на заказ' },
  { key: 'other', title: 'Другое', hint: 'опишу голосовым сообщением' },
] as const;

// Словарь курьера — из макета
export const CT = {
  cashLabel:   { ru: 'Возьмите наличными', kk: 'Қолма-қол алыңыз' },
  enterSum:    { ru: 'Наберите сумму', kk: 'Соманы теріңіз' },
  notEnough:   { ru: 'Не хватает', kk: 'Жетіспейді' },
  noExact:     { ru: 'Нет нужной суммы', kk: 'Керекті сома жоқ' },
  billHint:    { ru: 'Или нажмите купюру выше — подскажем сдачу сами.',
                 kk: 'Немесе жоғарыдағы банкнотты басыңыз — қайтарымды өзіміз айтамыз.' },
  change:      { ru: 'Сдача', kk: 'Қайтарым' },
  kaspiPaid:   { ru: 'Kaspi оплачен', kk: 'Kaspi төленген' },
  cash:        { ru: 'наличные', kk: 'қолма-қол' },
  tellManager: { ru: 'скажите менеджеру причину словами',
                 kk: 'менеджерге себебін сөзбен айтыңыз' },
  myCash:      { ru: 'Наличных у меня', kk: 'Менде қолма-қол' },
  toDeliver:   { ru: 'Вручить', kk: 'Тапсыру' },
  delivered:   { ru: 'Вручено', kk: 'Тапсырылды' },
  emptyT:      { ru: 'Рейс закрыт', kk: 'Рейс жабық' },
  emptyD:      { ru: 'Все заказы вручены и наличные сданы. Новый рейс придёт сюда сам.',
                 kk: 'Барлық тапсырыс тапсырылды. Жаңа рейс осында өзі келеді.' },
} as const;

export type CourierLang = 'ru' | 'kk';
export const ct = (k: keyof typeof CT, lang: CourierLang = 'ru') => CT[k][lang];

/** Расстояние и время до точки — подпись из макета «12 мин · 2,4 км». */
export function etaLabel(minutes?: number, km?: number): string | null {
  if (minutes == null && km == null) return null;
  const parts: string[] = [];
  if (minutes != null) parts.push(`${minutes} мин`);
  if (km != null) parts.push(`${km.toFixed(1).replace('.', ',')} км`);
  return parts.join(' · ');
}

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
  lang?: CourierLang;
}) {
  const lang = props.lang ?? 'ru';
  const [openId, setOpenId] = useState<string | null>(null);
  const [cashFor, setCashFor] = useState<CourierOrderVm | null>(null);
  const [returnFor, setReturnFor] = useState<CourierOrderVm | null>(null);
  const s = tripSummary(props.orders, props.trip);

  // ── приём наличных у двери ──
  if (cashFor) {
    const hints = doorChangeHints(cashFor.cashDue);
    return (
      <div className="cr-page cr-cash">
        <p className="cr-cash-label">{ct('cashLabel', lang)}</p>
        <b className="cr-cash-sum money">{fmt(cashFor.cashDue)}</b>
        <ul className="cr-hints">
          {hints.map((h, i) => (
            <li key={i}>с {fmt(h.note)} — {ct('change', lang)} <b>{fmt(h.change)}</b></li>
          ))}
        </ul>
        <p className="cr-dim">{ct('billHint', lang)}</p>
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
          <button key={r.key} className="btn cr-big cr-reason" onClick={() => {
            props.onReturned(returnFor.orderId, r.title); setReturnFor(null); setOpenId(null);
          }}>
            <span>
              <b>{r.title}</b>
              <em>{r.hint}</em>
            </span>
          </button>
        ))}
        <p className="cr-dim">{ct('tellManager', lang)}</p>
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
          <span>{ct('myCash', lang)}</span>
          <b className="money">{fmt(s.cashDebt)}</b>
        </div>
      </header>

      <div className="cr-progress">
        {ct('toDeliver', lang)}: <b>{s.toDeliver}</b> · {ct('delivered', lang)}: <b>{s.delivered}</b>
        {s.cashOrdersLeft > 0 && <span className="cr-cashleft"> · наличными ещё {s.cashOrdersLeft}</span>}
      </div>

      {props.orders.length === 0 && (
        <div className="state-empty">
          <b>{ct('emptyT', lang)}</b>
          <span>{ct('emptyD', lang)}</span>
        </div>
      )}
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
                  ? <span className="cr-cash-badge money">{fmt(o.cashDue)} · {ct('cash', lang)}</span>
                  : <span className="cr-paid-badge">{ct('kaspiPaid', lang)}</span>}
                {etaLabel(o.etaMinutes, o.distanceKm) && (
                  <span className="cr-eta">{etaLabel(o.etaMinutes, o.distanceKm)}</span>
                )}
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

// ═══════════════ ТЕКСТЫ ЭКРАНОВ РЕЙСА ═══════════════
// Курьер работает одной рукой на бегу — каждое слово должно
// отвечать на вопрос «что делать сейчас», а не описывать состояние.

export const TRIP_COPY = {
  screenTitle: 'Курьер · телефон · тёмная тема',
  purpose: 'Довезти, взять деньги, не запутаться в сдаче',
  screensCount: '4 экрана рейса',

  // 01 — список заказов
  listTitle: '01 · Заказы рейса',
  debtLabel: 'Долг наличных',
  // Кнопка сдачи видна постоянно: курьер должен знать сумму,
  // не считая в уме между адресами
  handoverBtn: (debt: string) => `Сдать ${debt} на кассу`,

  // 02 — карточка адреса
  cardTitle: '02 · Карточка заказа',
  acceptedAt: (t: string, due: string) => `принят в ${t} · доставка к ${due}`,
  guestLabel: 'Гость',
  takeCash: 'Взять наличными',
  deliveredBtn: 'Вручил · принять деньги',

  // 03 — приём денег
  cashTitle: '03 · Приём наличных · живой',
  cashPrompt: 'Сколько дал гость',

  // 04 — возврат
  failTitle: '04 · Не вручено',
  failPrompt: 'Что случилось?',
  // Курьер боится, что недоставленное вычтут из зарплаты.
  // Снимаем этот страх прямо на экране — иначе он начнёт
  // «доставлять» то, что не доставил
  failNote: 'Менеджер увидит причину сразу и позвонит гостю. Заказ вернётся в рейс или уйдёт в отмену.',
  foodNote: 'Еда останется у вас. Списание оформит менеджер — с вашей зарплаты ничего не удержится.',
} as const;

/** Склонение заказов для шапки рейса. */
export function ordersLabel(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} заказ`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} заказа`;
  return `${n} заказов`;
}

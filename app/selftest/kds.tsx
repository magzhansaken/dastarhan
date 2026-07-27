// apps/kds/src/KdsScreen.tsx
// P1-7: KDS — экран кухни. Анализ: QR workflow («Начать приготовление» →
// «Готово» по блюду и по заказу; отмена с комментарием и выбором со
// списанием/без; места приготовления; уведомление кассе), r_keeper KDS Pro
// (рецепт с экрана, стоп-лист с кухни, электронная очередь), Poster Kitchen
// Kit. Наши профи-добавки сверх рынка:
//  1) ПАРТИЯ ПОВАРА: сводка «Плов ×7 в работе по всем тикетам» — повар
//     жарит партиями, а не по одному (ни у кого нет в явной сводке)
//  2) эскалация цветом по ВРЕМЕНИ ЦЕЛИ канала: зал 15 мин, доставка 20,
//     самовывоз 10 — пороги по режиму заказа, не один на всех
//  3) recall: вернуть случайно нажатое «Готово» (реальная боль касаний)
//  4) FIFO свят: тикеты в порядке отправки, просрочка мигает, но не
//     перепрыгивает (перескок ломает справедливость очереди)

import React, { useMemo, useState } from 'react';

export type Money = number;

// ═══════════════ ДАННЫЕ И VIEW-MODEL ═══════════════

export interface KdsItem {
  itemId: string; orderId: string; productId: string; name: string;
  qty: number;
  modifiers: string[];
  comment?: string;
  course: number;
  station?: string;             // место приготовления (QR): hot|cold|bar
  kitchenStatus: 'SENT' | 'COOKING' | 'COOKED';
  sentAt: Date;
}

export interface KdsTicketIn {
  orderId: string; number: number; mode: 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
  tableName?: string;
  items: KdsItem[];
}

/** Пороги цели по каналу (наша добавка: не один таймер на всех). */
export const TARGET_MIN: Record<KdsTicketIn['mode'], number> = {
  TAKEOUT: 10, DINE_IN: 15, DELIVERY: 20,
};

export type UrgencyLevel = 'ok' | 'warn' | 'late';

export function urgency(sentAt: Date, mode: KdsTicketIn['mode'], now: Date): { minutes: number; level: UrgencyLevel } {
  const minutes = Math.floor((now.getTime() - sentAt.getTime()) / 60000);
  const target = TARGET_MIN[mode];
  const level: UrgencyLevel = minutes >= target ? 'late' : minutes >= Math.floor(target * 0.7) ? 'warn' : 'ok';
  return { minutes, level };
}

export interface KdsTicketVm extends KdsTicketIn {
  minutes: number;
  level: UrgencyLevel;
  allCooked: boolean;   // все позиции готовы → тикет можно «Собрано»
}

/** Тикеты цеха: фильтр по станции, FIFO по самой ранней отправке,
 *  готовые целиком заказы уходят (в архив/сборщику — правило QR). */
export function kdsTickets(input: KdsTicketIn[], station: string | null, now: Date): KdsTicketVm[] {
  const out: KdsTicketVm[] = [];
  for (const t of input) {
    const items = station ? t.items.filter((i) => (i.station ?? 'hot') === station) : t.items;
    const active = items.filter((i) => i.kitchenStatus !== 'COOKED');
    if (!items.length) continue;
    const first = items.reduce((a, b) => (a.sentAt < b.sentAt ? a : b));
    const u = urgency(first.sentAt, t.mode, now);
    out.push({
      ...t, items,
      minutes: u.minutes, level: u.level,
      allCooked: active.length === 0,
    });
  }
  // FIFO: по времени первой отправки; полностью готовые — в конец (на снятие)
  return out.sort((a, b) => {
    if (a.allCooked !== b.allCooked) return a.allCooked ? 1 : -1;
    const fa = a.items.reduce((x, y) => (x.sentAt < y.sentAt ? x : y)).sentAt.getTime();
    const fb = b.items.reduce((x, y) => (x.sentAt < y.sentAt ? x : y)).sentAt.getTime();
    return fa - fb;
  });
}

/** ПАРТИЯ ПОВАРА: сколько одинаковых блюд в работе по всем тикетам. */
export function batchSummary(input: KdsTicketIn[], station: string | null): { name: string; qty: number }[] {
  const map = new Map<string, { name: string; qty: number }>();
  for (const t of input)
    for (const i of t.items) {
      if (i.kitchenStatus === 'COOKED') continue;
      if (station && (i.station ?? 'hot') !== station) continue;
      const e = map.get(i.productId) ?? { name: i.name, qty: 0 };
      e.qty += i.qty;
      map.set(i.productId, e);
    }
  return [...map.values()].filter((x) => x.qty >= 2).sort((a, b) => b.qty - a.qty);
}

/** Средняя скорость кухни за смену (минуты SENT→COOKED) — метрика владельцу. */
export function kitchenSpeed(done: { sentAt: Date; cookedAt: Date }[]): number | null {
  if (!done.length) return null;
  const total = done.reduce((s, d) => s + (d.cookedAt.getTime() - d.sentAt.getTime()), 0);
  return Math.round(total / done.length / 60000);
}

// recall-стек: вернуть случайное «Готово» (наша добавка)
export interface RecallEntry { itemId: string; at: Date }

export function pushRecall(stack: RecallEntry[], itemId: string, at: Date, keep = 5): RecallEntry[] {
  return [{ itemId, at }, ...stack].slice(0, keep);
}

// ═══════════════ ЭКРАН ═══════════════

export function KdsScreen(props: {
  tickets: KdsTicketIn[];
  stations: { id: string; name: string }[];
  now: Date;
  onStart: (itemId: string) => void;    // «Начать приготовление» (QR)
  onCooked: (itemId: string) => void;   // «Готово» по блюду
  onTicketDone: (orderId: string) => void; // «Готов весь заказ»
  onRecall: (itemId: string) => void;   // вернуть (наша добавка)
  lastCooked?: { itemId: string; name: string } | null;
}) {
  const [station, setStation] = useState<string | null>(null);
  const vms = useMemo(() => kdsTickets(props.tickets, station, props.now), [props.tickets, station, props.now]);
  const batch = useMemo(() => batchSummary(props.tickets, station), [props.tickets, station]);

  return (
    <div className="kds-screen">
      <header className="kds-head">
        <div className="stations">
          <button className={`st ${station === null ? 'on' : ''}`} onClick={() => setStation(null)}>Все</button>
          {props.stations.map((s) => (
            <button key={s.id} className={`st ${station === s.id ? 'on' : ''}`}
              onClick={() => setStation(s.id)}>{s.name}</button>
          ))}
        </div>
        {props.lastCooked && (
          <button className="btn recall" onClick={() => props.onRecall(props.lastCooked!.itemId)}>
            ↩ Вернуть «{props.lastCooked.name}»
          </button>
        )}
      </header>

      {batch.length > 0 && (
        <div className="batch-bar">
          {batch.map((b, i) => (
            <span key={i} className="batch-chip">{b.name} ×{b.qty}</span>
          ))}
        </div>
      )}

      <div className="tickets">
        {vms.map((t) => (
          <section key={t.orderId} className={`ticket ticket-${t.level} ${t.allCooked ? 'ticket-done' : ''}`}>
            <header className="tk-head">
              <b>№{t.number}</b>
              <span className="tk-mode">{t.mode === 'DINE_IN' ? (t.tableName ? `Стол ${t.tableName}` : 'Зал')
                : t.mode === 'DELIVERY' ? 'Доставка' : 'С собой'}</span>
              <span className={`tk-timer tk-${t.level}`}>{t.minutes} мин</span>
            </header>
            <ul className="tk-items">
              {t.items.map((i) => (
                <li key={i.itemId} className={`tki tki-${i.kitchenStatus.toLowerCase()}`}>
                  <span className="tki-name">{i.name} {i.qty > 1 ? `×${i.qty}` : ''}
                    {i.modifiers.length > 0 && <em className="tki-mods">{i.modifiers.join(', ')}</em>}
                    {i.comment && <em className="tki-comment">💬 {i.comment}</em>}
                  </span>
                  {i.kitchenStatus === 'SENT' && (
                    <button className="btn tki-btn" onClick={() => props.onStart(i.itemId)}>Начать</button>
                  )}
                  {i.kitchenStatus === 'COOKING' && (
                    <button className="btn tki-btn btn-ok" onClick={() => props.onCooked(i.itemId)}>Готово</button>
                  )}
                  {i.kitchenStatus === 'COOKED' && <span className="tki-ok">✓</span>}
                </li>
              ))}
            </ul>
            {t.allCooked && (
              <button className="btn btn-ok tk-done-btn" onClick={() => props.onTicketDone(t.orderId)}>
                Собрано — уведомить
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

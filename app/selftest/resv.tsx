// apps/backoffice/src/reservations/Reservations.tsx
// P1-10: брони столов. Анализ: r_keeper — «ШАХМАТКА РЕЗЕРВОВ» (сетка
// столы×время, фильтры по залу/дате, отдельное право) — лучшая модель
// рынка; Paloma/QR — брони есть, но тонко. Математика пересечений уже
// готова в Этапе 9 (overlaps) — вертикали кормят рестораны, как задумано.
// Наши профи-добавки сверх рынка:
//  1) «СКОРО БРОНЬ» на карте зала: за 60 мин стол подсвечивается — официант
//     не посадит гостей на бронированный стол (ни у кого нет в явном виде)
//  2) no-show grace: гость не пришёл за 20 мин → авто-освобождение + счётчик
//     no-show в карточке гостя (3+ — предупреждение при новой брони)
//  3) депозит брони через готовый кошелёк Этапа 6 (списание при no-show)
import React, { useMemo, useState } from 'react';
import { overlaps } from './vert.ts';
import type { Slot } from './vert.ts';

export type Money = number;

export class ReservationError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

// ═══════════════ МОДЕЛЬ И ВАЛИДАЦИЯ ═══════════════

export type ResStatus = 'BOOKED' | 'SEATED' | 'NO_SHOW' | 'CANCELLED';

export interface Reservation {
  id: string; tableId: string;
  startAt: Date; endAt: Date;
  guestPhone: string; guestName?: string;
  persons: number;
  status: ResStatus;
  depositAmount?: Money; // предоплата с кошелька (Этап 6)
  note?: string;
}

/** Новая бронь: пересечения по столу (математика Этапа 9), вместимость. */
export function validateReservation(
  cand: { tableId: string; startAt: Date; endAt: Date; persons: number },
  tableSeats: number,
  existing: Reservation[],
): void {
  if (cand.endAt <= cand.startAt) throw new ReservationError('BAD_RANGE', 'Конец раньше начала');
  if (cand.persons < 1) throw new ReservationError('BAD_PERSONS', 'Минимум 1 гость');
  if (cand.persons > tableSeats)
    throw new ReservationError('OVER_CAPACITY', `Стол на ${tableSeats}, гостей ${cand.persons}`);
  const busy = existing.filter((r) =>
    r.tableId === cand.tableId && (r.status === 'BOOKED' || r.status === 'SEATED'));
  for (const r of busy)
    if (overlaps(cand as Slot, r as Slot))
      throw new ReservationError('OVERLAP', `Пересекается с бронью ${r.guestName ?? r.guestPhone}`);
}

/** Состояние стола для карты зала: «скоро бронь» за 60 мин (наша добавка). */
export function tableReservationBadge(
  tableId: string, reservations: Reservation[], now: Date, soonMin = 60,
): { kind: 'reserved-now' | 'reserved-soon' | null; at?: string; name?: string } {
  const act = reservations.filter((r) => r.tableId === tableId && r.status === 'BOOKED');
  for (const r of act) {
    if (r.startAt <= now && now < r.endAt)
      return { kind: 'reserved-now', name: r.guestName ?? r.guestPhone };
    const minsTo = (r.startAt.getTime() - now.getTime()) / 60000;
    if (minsTo > 0 && minsTo <= soonMin)
      return {
        kind: 'reserved-soon',
        at: `${String(r.startAt.getHours()).padStart(2, '0')}:${String(r.startAt.getMinutes()).padStart(2, '0')}`,
        name: r.guestName ?? r.guestPhone,
      };
  }
  return { kind: null };
}

/** No-show: не пришёл за grace минут после начала → авто-освобождение. */
export function detectNoShows(reservations: Reservation[], now: Date, graceMin = 20): string[] {
  return reservations
    .filter((r) => r.status === 'BOOKED'
      && now.getTime() - r.startAt.getTime() > graceMin * 60000)
    .map((r) => r.id);
}

/** Предупреждение о госте-прогульщике (3+ no-show — наша добавка). */
export function guestRiskNote(noShowCount: number): string | null {
  if (noShowCount >= 3) return `Гость не пришёл ${noShowCount} раза — предложите депозит`;
  return null;
}

// ═══════════════ ШАХМАТКА (r_keeper-модель) ═══════════════

export interface GridCell { tableId: string; hour: number; res: Reservation | null }

/** Сетка столы×часы на день (шахматка): каждая ячейка — час стола. */
export function reservationGrid(
  tables: { id: string; name: string }[],
  reservations: Reservation[],
  day: Date, fromHour = 10, toHour = 23,
): { hours: number[]; rows: { tableId: string; name: string; cells: GridCell[] }[] } {
  const hours: number[] = [];
  for (let h = fromHour; h < toHour; h++) hours.push(h);
  const rows = tables.map((t) => ({
    tableId: t.id, name: t.name,
    cells: hours.map((h) => {
      const cellStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
      const cellEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h + 1);
      const res = reservations.find((r) =>
        r.tableId === t.id && (r.status === 'BOOKED' || r.status === 'SEATED')
        && overlaps({ startAt: cellStart, endAt: cellEnd }, r)) ?? null;
      return { tableId: t.id, hour: h, res };
    }),
  }));
  return { hours, rows };
}

// ═══════════════ ЭКРАН ═══════════════

const hh = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function ReservationsScreen(props: {
  day: Date;
  tables: { id: string; name: string; seats: number }[];
  reservations: Reservation[];
  now: Date;
  onSeat: (id: string) => void;      // гость пришёл
  onCancel: (id: string) => void;
  onNew: (tableId: string, hour: number) => void; // клик по пустой ячейке
}) {
  const grid = useMemo(
    () => reservationGrid(props.tables, props.reservations, props.day),
    [props.tables, props.reservations, props.day]);
  const noShows = detectNoShows(props.reservations, props.now);

  return (
    <div className="res-screen">
      <header className="doc-head">
        <h2>Брони столов</h2>
        {noShows.length > 0 && (
          <span className="alert-warn">Не пришли (авто-освобождение): {noShows.length}</span>
        )}
      </header>
      <table className="res-grid">
        <thead><tr><th>Стол</th>{grid.hours.map((h) => <th key={h}>{h}:00</th>)}</tr></thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.tableId}>
              <td className="res-table-name">{row.name}</td>
              {row.cells.map((c) => (
                <td key={c.hour}
                  className={c.res ? `cell cell-${c.res.status.toLowerCase()}` : 'cell cell-free'}
                  onClick={() => !c.res && props.onNew(c.tableId, c.hour)}>
                  {c.res && c.hour === c.res.startAt.getHours() && (
                    <span className="res-chip">
                      {hh(c.res.startAt)} {c.res.guestName ?? c.res.guestPhone} ·{c.res.persons}ч
                      {c.res.depositAmount ? ' 💰' : ''}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="res-today">
        {props.reservations
          .filter((r) => r.status === 'BOOKED')
          .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
          .map((r) => (
            <li key={r.id} className={noShows.includes(r.id) ? 'res-noshow' : ''}>
              <b>{hh(r.startAt)}</b> {r.guestName ?? r.guestPhone} · {r.persons} чел
              <button className="btn" onClick={() => props.onSeat(r.id)}>Пришли</button>
              <button className="btn" onClick={() => props.onCancel(r.id)}>Отмена</button>
            </li>
          ))}
      </ul>
    </div>
  );
}

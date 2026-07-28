// apps/backoffice/src/screens/HallEditor.tsx
// Редактор карты зала. Владелец расставляет столы мышкой один раз
// при запуске и правит при перестановке мебели.
//
// Сетка 20 px: столы выравниваются сами, план не выглядит кривым
// даже если тянуть на глаз.
import React, { useState, useRef, useEffect } from 'react';

const API = '/api/v1';
const GRID = 20;

interface TableVm {
  tableId: string; name: string; seats: number;
  x: number; y: number; shape: string;
  busy: boolean; total: number; minutes: number; isLong: boolean;
}

interface HallVm { hallId: string; name: string; tables: TableVm[] }

export function HallEditor({ token, locationId }: { token: string; locationId: string }) {
  const [halls, setHalls] = useState<HallVm[]>([]);
  const [activeHall, setActiveHall] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const load = () => {
    fetch(`${API}/hall/map?locationId=${locationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((d: HallVm[]) => {
        setHalls(d);
        if (!activeHall && d.length) setActiveHall(d[0].hallId);
      })
      .catch(() => setHalls([]));
  };

  useEffect(() => {
    load();
    // В рабочем режиме карта живая: официант видит, где освободилось.
    // В режиме правки не обновляем — иначе стол «прыгнет» под рукой
    if (edit) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [locationId, edit]);

  const hall = halls.find((h) => h.hallId === activeHall);

  const snap = (v: number) => Math.max(0, Math.round(v / GRID) * GRID);

  const onDown = (e: React.MouseEvent, t: TableVm) => {
    if (!edit) { setSel(t.tableId); return; }
    const box = canvas.current!.getBoundingClientRect();
    setDrag({ id: t.tableId, dx: e.clientX - box.left - t.x, dy: e.clientY - box.top - t.y });
  };

  const onMove = (e: React.MouseEvent) => {
    if (!drag || !hall) return;
    const box = canvas.current!.getBoundingClientRect();
    const x = snap(e.clientX - box.left - drag.dx);
    const y = snap(e.clientY - box.top - drag.dy);
    setHalls((hs) => hs.map((h) => h.hallId !== hall.hallId ? h : {
      ...h, tables: h.tables.map((t) => t.tableId === drag.id ? { ...t, x, y } : t),
    }));
  };

  const onUp = () => {
    if (!drag || !hall) return;
    const t = hall.tables.find((x) => x.tableId === drag.id);
    if (t) {
      // Сохраняем сразу: владелец не должен помнить про кнопку «Сохранить»
      fetch(`${API}/hall/tables/${t.tableId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ x: t.x, y: t.y }),
      }).catch(() => null);
    }
    setDrag(null);
  };

  const addTable = async () => {
    if (!hall) return;
    const name = prompt('Номер стола');
    if (!name) return;
    const seats = Number(prompt('Сколько мест?', '4')) || 4;

    const r = await fetch(`${API}/hall/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        hallId: hall.hallId, name, seats,
        // Новый стол в свободном углу, а не поверх существующих
        x: 40 + (hall.tables.length % 6) * 120,
        y: 40 + Math.floor(hall.tables.length / 6) * 120,
        shape: seats > 4 ? 'rect' : seats <= 2 ? 'square' : 'round',
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => null);
      alert(e?.message ?? 'Не удалось добавить стол');
      return;
    }
    load();
  };

  const removeTable = async (t: TableVm) => {
    if (!confirm(`Убрать стол ${t.name} с плана?`)) return;
    const r = await fetch(`${API}/hall/tables/${t.tableId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => null);
      alert(e?.message ?? 'Не удалось убрать стол');
      return;
    }
    setSel(null);
    load();
  };

  const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

  if (!halls.length) return (
    <div className="state-empty">
      <b>Залов пока нет</b>
      <span>Создайте зал, чтобы расставить столы</span>
    </div>
  );

  const busy = hall?.tables.filter((t) => t.busy).length ?? 0;

  return (
    <div className="hall-editor">
      <header className="hall-head">
        <div className="hall-tabs">
          {halls.map((h) => (
            <button key={h.hallId} className={`hall-tab ${h.hallId === activeHall ? 'on' : ''}`}
              onClick={() => setActiveHall(h.hallId)}>
              {h.name}
              <em>{h.tables.filter((t) => t.busy).length}/{h.tables.length}</em>
            </button>
          ))}
        </div>
        <div className="hall-acts">
          <span className="hint">{busy} из {hall?.tables.length ?? 0} занято</span>
          {edit && <button className="btn" onClick={addTable}>Добавить стол</button>}
          <button className={`btn ${edit ? 'btn-primary' : ''}`} onClick={() => { setEdit(!edit); setSel(null); }}>
            {edit ? 'Готово' : 'Изменить план'}
          </button>
        </div>
      </header>

      <div className={`hall-canvas ${edit ? 'editing' : ''}`} ref={canvas}
        onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
        {hall?.tables.map((t) => (
          <div key={t.tableId}
            className={`hall-table ${t.shape} ${t.busy ? 'busy' : 'free'} ${t.isLong ? 'long' : ''} ${sel === t.tableId ? 'sel' : ''}`}
            style={{ left: t.x, top: t.y }}
            onMouseDown={(e) => onDown(e, t)}>
            <b>{t.name}</b>
            <span className="seats">{t.seats}</span>
            {t.busy && !edit && (
              <span className="tbl-info">
                {fmt(t.total)}
                {/* Время за столом важнее суммы: два часа с пустым чеком —
                    это забытый стол, и официант должен подойти */}
                <em>{t.minutes} мин</em>
              </span>
            )}
          </div>
        ))}
      </div>

      {edit && sel && (
        <div className="hall-panel">
          <b>Стол {hall?.tables.find((t) => t.tableId === sel)?.name}</b>
          <button className="btn btn-danger"
            onClick={() => removeTable(hall!.tables.find((t) => t.tableId === sel)!)}>
            Убрать с плана
          </button>
        </div>
      )}

      <p className="hint">
        {edit
          ? 'Перетащите столы мышкой — план сохраняется сам. Нажмите на стол, чтобы убрать его.'
          : 'Жёлтый — гость сидит дольше 90 минут. Возможно, забыли про стол.'}
      </p>
    </div>
  );
}

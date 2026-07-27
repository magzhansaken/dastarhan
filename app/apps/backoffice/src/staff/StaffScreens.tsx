// apps/backoffice/src/staff/StaffScreens.tsx
// Экраны «Сотрудники и роли» — пришли из дизайн-ревизии.
// Анализ: QuickResto «Должности и сотрудники» (PIN, логин бэк-офиса,
// блокировка учётки, оплата труда на должность ИЛИ на сотрудника,
// ссылка для чаевых по QR) + их же модель четырёх состояний права.
// Наши добавки: доступ по точкам (в одной точке менеджер, в другой кассир),
// налоговая подсказка по способу чаевых, журнал действий сотрудника.
import React, { useState } from 'react';
import {
  PERMISSIONS, PERMISSION_GROUPS, PERMISSION_STATE_LABELS, ROLE_PRESETS,
  PERMISSION_HINTS, permissionsSummary, diffFromPreset,
  resolvePermission,
} from '@dastarhan/shared';
import type { PermissionKey, PermissionState, RolePermissions } from '@dastarhan/shared';
import { tipLink, tipsSummary, tipMethodNote } from '../../../api/src/staff/tips.logic';
import type { TipRecord, TipMethod } from '../../../api/src/staff/tips.logic';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ СПИСОК СОТРУДНИКОВ ═══════════════

export interface StaffRow {
  userId: string; name: string; phone: string;
  roleName: string;
  points: { id: string; name: string; roleName: string }[];
  active: boolean;
  lastLoginAt: Date | null;
}

export function lastLoginLabel(at: Date | null, now: Date): string {
  if (!at) return 'ни разу';
  const min = Math.floor((now.getTime() - at.getTime()) / 60000);
  // «только что» держим до двух минут: значение реже дёргается при
  // автообновлении списка, а точность до минуты здесь никому не нужна
  if (min < 2) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн назад`;
}

export function StaffList(props: {
  rows: StaffRow[]; now: Date;
  onOpen: (userId: string) => void;
  onAdd: () => void;
}) {
  const [q, setQ] = useState('');
  const rows = props.rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="staff-list">
      <header className="doc-head">
        <h2>Сотрудники</h2>
        <button className="btn btn-accent" onClick={props.onAdd}>Добавить сотрудника</button>
      </header>
      <div className="filters">
        <input placeholder="Поиск по имени" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="doc-table">
        <thead><tr>
          <th>Сотрудник</th><th>Роль</th><th>Доступ по точкам</th><th>Статус</th><th>Последний вход</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} onClick={() => props.onOpen(r.userId)}>
              <td><b>{r.name}</b><em className="unit"> {r.phone}</em></td>
              <td>{r.roleName}</td>
              <td>{r.points.map((p) => `${p.name} — ${p.roleName}`).join(' · ')}</td>
              <td className={r.active ? 'ok' : 'diff-neg'}>{r.active ? 'Активен' : 'Заблокирован'}</td>
              <td className="unit">{lastLoginLabel(r.lastLoginAt, props.now)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="empty-cell">Никого не нашли. Проверьте написание имени.</td></tr>
          )}
        </tbody>
      </table>
      <p className="hint">Кассир видит только кассу. Отчёты и себестоимость — у владельца и менеджера.</p>
    </div>
  );
}

// ═══════════════ КАРТОЧКА СОТРУДНИКА ═══════════════

export function StaffCard(props: {
  staff: {
    userId: string; name: string; phone: string; roleName: string;
    pin: string; login: string;
    points: { id: string; name: string; roleName: string }[];
    pay: { kind: 'salary' | 'hourly' | 'percent'; value: number };
    accruedThisMonth: number;
    tipSlug?: string; tipMethod?: TipMethod;
    active: boolean; joinedAt: Date;
  };
  tips: TipRecord[];
  period: { from: Date; to: Date };
  actions: { at: Date; text: string }[];
  onBlock: () => void;
  onCopyTipLink: () => void;
}) {
  const [pinShown, setPinShown] = useState(false);
  const s = props.staff;
  const t = tipsSummary(props.tips, s.userId, props.period.from, props.period.to);
  const note = s.tipMethod ? tipMethodNote(s.tipMethod, t.total) : null;
  const payLabel = s.pay.kind === 'salary' ? 'Оклад'
    : s.pay.kind === 'hourly' ? 'Ставка за час' : 'Процент с личных чеков';

  return (
    <div className="staff-card">
      <div className="staff-head">
        <div className="staff-avatar">{s.name.charAt(0)}</div>
        <div>
          <h2>{s.name}</h2>
          <span className="unit">
            {s.roleName} · в команде с {s.joinedAt.toLocaleDateString('ru-RU')}
          </span>
        </div>
        <span className={`ml-auto ${s.active ? 'ok' : 'diff-neg'}`}>{s.active ? 'Активен' : 'Заблокирован'}</span>
      </div>

      <div className="staff-field">
        <label>Телефон</label>
        <input defaultValue={s.phone} />
      </div>
      <div className="staff-field">
        <label>PIN для кассы</label>
        <input type={pinShown ? 'text' : 'password'} defaultValue={s.pin} readOnly />
        <button className="btn" onClick={() => setPinShown(!pinShown)}>
          {pinShown ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      <div className="staff-field">
        <label>Логин для бэк-офиса</label>
        <input defaultValue={s.login} />
      </div>

      <h3>Доступ по точкам</h3>
      <div className="staff-points">
        {s.points.map((p) => (
          <div key={p.id} className="staff-point"><span>{p.name}</span><b>{p.roleName}</b></div>
        ))}
      </div>
      <p className="staff-note">На одной точке менеджер, на другой кассир — так можно.</p>

      <h3>Оплата труда</h3>
      <div className="staff-field">
        <label>{payLabel}</label>
        <input defaultValue={s.pay.kind === 'percent' ? `${s.pay.value}%` : fmt(s.pay.value)} />
      </div>
      <p className="staff-note">Начислено в этом месяце: <b>{fmt(s.accruedThisMonth)}</b></p>

      {s.tipSlug && (
        <div className="tips-block">
          <h3>Чаевые по QR</h3>
          <p className="staff-note">
            Личная ссылка {s.name.split(' ')[0]}. Гость сканирует QR на чеке — деньги идут напрямую ей на Kaspi.
          </p>
          <div className="tips-link">
            <span>{tipLink(s.tipSlug)}</span>
            <button className="btn" onClick={props.onCopyTipLink}>Копировать</button>
          </div>
          <div>Чаевых за период: <b className="tips-sum">{fmt(t.total)}</b></div>
          {note && note.tone === 'ok' && <p className="tips-fair">{note.text}</p>}
          {note && note.tone === 'warn' && <p className="tips-warn">⚠ {note.text}</p>}
        </div>
      )}

      <h3>Что делала на кассе</h3>
      <ul className="staff-actions">
        {props.actions.slice(0, 5).map((a, i) => (
          <li key={i}><span className="unit">{a.at.toTimeString().slice(0, 5)}</span> {a.text}</li>
        ))}
        {props.actions.length === 0 && <li className="unit">Действий за смену пока нет</li>}
      </ul>

      <button className="btn btn-danger" onClick={props.onBlock}>Заблокировать доступ</button>
      <p className="staff-note">
        PIN перестанет работать сразу. Смены и чеки останутся в истории — разблокировать можно в любой момент.
      </p>
    </div>
  );
}

// ═══════════════ РЕДАКТОР РОЛИ: ЧЕТЫРЕ СОСТОЯНИЯ ═══════════════

const STATE_ORDER: PermissionState[] = ['allowed', 'self_pin', 'elevated_pin', 'denied'];
const STATE_CLASS: Record<PermissionState, string> = {
  allowed: 'st-allowed', self_pin: 'st-self', elevated_pin: 'st-elevated', denied: 'st-denied',
};

export function RoleEditor(props: {
  roleName: string;
  permissions: RolePermissions;
  presetKey?: string;
  onPreset: (key: string) => void;
  onChange: (key: PermissionKey, state: PermissionState) => void;
  onSave: () => void;
  dirty: boolean;
}) {
  return (
    <div className="role-editor">
      <header className="doc-head">
        <h2>Права роли: {props.roleName}</h2>
        <button className="btn btn-ok" disabled={!props.dirty} onClick={props.onSave}>
          {props.dirty ? 'Сохранить изменения' : 'Всё сохранено'}
        </button>
      </header>

      <div className="role-presets">
        {Object.entries(ROLE_PRESETS).map(([k, v]) => (
          <button key={k} className={`role-preset ${props.presetKey === k ? 'on' : ''}`}
            onClick={() => props.onPreset(k)}>{v.name}</button>
        ))}
        <button className="role-preset" onClick={() => props.onPreset('CUSTOM')}>+ Сделать свою роль</button>
      </div>

      {(() => {
        const allKeys = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[];
        const s = permissionsSummary(props.permissions, allKeys as any);
        const preset = props.presetKey ? ROLE_PRESETS[props.presetKey]?.permissions : null;
        const changed = preset ? diffFromPreset(props.permissions, preset, allKeys as any) : 0;
        return (
          <div className="staff-note" style={{ padding: '0 16px 10px' }}>
            {allKeys.length} прав в {PERMISSION_GROUPS.length} разделах · четыре состояния у каждого права
            <br />{s.open} из {s.total} открыто · {s.pin} под PIN · {s.hidden} скрыто
            {preset && ` · ${changed ? `изменено прав: ${changed}` : 'пресет без изменений'}`}
          </div>
        );
      })()}
      {PERMISSION_GROUPS.map((g) => (
        <section key={g.id} className="perm-group">
          <h4>{g.name}</h4>
          {g.keys.map((key) => {
            const state = resolvePermission(props.permissions, key);
            return (
              <div key={key} className="perm-row">
                <span className="perm-name">{PERMISSIONS[key]}
                  {PERMISSION_HINTS[key] && <em className="perm-hint">{PERMISSION_HINTS[key]}</em>}
                </span>
                <span className="perm-states">
                  {STATE_ORDER.map((st) => (
                    <button key={st}
                      className={`${state === st ? `on ${STATE_CLASS[st]}` : ''}`}
                      title={PERMISSION_STATE_LABELS[st].hint}
                      onClick={() => props.onChange(key, st)}>
                      {PERMISSION_STATE_LABELS[st].short}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
        </section>
      ))}

      <p className="perm-hint">
        «Своим PIN» защищает от терминала, оставленного без присмотра. «PIN старшего» — от самого сотрудника:
        удалить позицию после отправки на кухню кассир не сможет без менеджера.
      </p>
    </div>
  );
}

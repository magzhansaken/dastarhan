// apps/backoffice/src/screens/BackofficeScreens.tsx
// Три ключевых экрана бэк-офиса. Язык владельца, навигация по задачам.
import React, { useMemo, useState } from 'react';
import {
  buildNav, dashCards, DashInput, TcLine, lossPct, liveCost, tcErrors,
  SupplyLineVm, supplyTotals, supplyErrors, onboardingSteps, onboardingProgress,
} from './bo.ts';
import { CostContext } from './cost.ts';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU')} ₸`;

// ═══════════════ ДАШБОРД «КАК ИДУТ ДЕЛА» ═══════════════
export function Dashboard({ data }: { data: DashInput }) {
  const c = dashCards(data);
  return (
    <div className="dash">
      <section className="card card-revenue">
        <h3>Выручка сегодня</h3>
        <b className="money-xl">{fmt(c.revenue.value)}</b>
        {c.revenue.diffPct !== null && (
          <span className={`diff diff-${c.revenue.tone}`}>
            {c.revenue.diffPct >= 0 ? '↑' : '↓'} {Math.abs(c.revenue.diffPct)}% ко вчера
          </span>
        )}
      </section>
      <section className="card">
        <h3>Чеки</h3>
        <b>{c.checks.value}</b>
        <span>средний {fmt(c.checks.avg)}</span>
      </section>
      <section className="card card-attention">
        <h3>Требует внимания</h3>
        {c.attention.length === 0 && <p className="ok">Всё спокойно 👌</p>}
        <ul>
          {c.attention.map((a, i) => (
            <li key={i} className={`alert alert-${a.severity.toLowerCase()}`}>{a.text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ═══════════════ РЕДАКТОР ТЕХКАРТЫ (живой фудкост) ═══════════════
export function TechCardEditor(props: {
  productName: string; salePrice: number; ctx: CostContext;
  initial: TcLine[]; outputQty: number;
  componentSearch: (q: string) => { productId: string; name: string }[];
  onSave: (lines: TcLine[], outputQty: number) => void;
}) {
  const [lines, setLines] = useState<TcLine[]>(props.initial);
  const [out, setOut] = useState(props.outputQty);
  const live = useMemo(
    () => liveCost(lines, out, props.salePrice, props.ctx),
    [lines, out, props.salePrice, props.ctx],
  );
  const errors = tcErrors(lines, out);
  const upd = (i: number, patch: Partial<TcLine>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="tc-editor">
      <header>
        <h2>Техкарта: {props.productName}</h2>
        {/* ЖИВОЙ фудкост — обновляется на каждый ввод (глубже QR) */}
        <div className={`foodcost foodcost-${live.foodcostPct > 35 ? 'bad' : 'ok'}`}>
          <span>Себестоимость {fmt(live.portionCost)}</span>
          <b>Фудкост {live.foodcostPct}%</b>
          <span>Маржа {fmt(live.margin)}</span>
        </div>
      </header>
      <table className="tc-table">
        <thead><tr><th>Продукт</th><th>Брутто, г/мл</th><th>Нетто</th><th>Потери</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              <td><input type="number" value={l.brutto}
                onChange={(e) => upd(i, { brutto: +e.target.value })} /></td>
              <td><input type="number" value={l.netto}
                onChange={(e) => upd(i, { netto: +e.target.value })} /></td>
              <td className="loss">{lossPct(l)}%</td>
              <td><button onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tc-output">
        <label>Выход порции, г/мл
          <input type="number" value={out} onChange={(e) => setOut(+e.target.value)} />
        </label>
      </div>
      {errors.length > 0 && (
        <ul className="errors">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
      <button className="btn btn-accent" disabled={errors.length > 0}
        onClick={() => props.onSave(lines, out)}>
        Сохранить новой версией
      </button>
      <p className="hint">История себестоимости прошлых продаж не изменится — техкарты версионируются.</p>
    </div>
  );
}

// ═══════════════ ОНБОРДИНГ «15 МИНУТ ДО ЧЕКА» ═══════════════
export function OnboardingWizard(props: {
  vertical: string; state: Record<string, boolean>; onGo: (stepId: string) => void;
}) {
  const steps = onboardingSteps(props.vertical, props.state);
  const p = onboardingProgress(steps);
  return (
    <div className="onboarding">
      <header>
        <h2>До первого чека — {p.minutesLeft} мин</h2>
        <div className="progress"><div style={{ width: `${p.pct}%` }} /></div>
      </header>
      <ol className="onb-steps">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? 'done' : ''}>
            <span>{s.done ? '✓' : '○'} {s.title}</span>
            {!s.done && <button onClick={() => props.onGo(s.id)}>Настроить · {s.minutes} мин</button>}
          </li>
        ))}
      </ol>
      {p.pct === 100 && <div className="onb-finish">🎉 Готово! Откройте смену на кассе и пробейте первый чек.</div>}
    </div>
  );
}

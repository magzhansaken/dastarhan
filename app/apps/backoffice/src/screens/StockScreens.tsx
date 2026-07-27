// apps/backoffice/src/screens/StockScreens.tsx
// P0-5: экраны склада. Анализ: QR приходные накладные (поставщик из
// контрагентов, дата любая, ЦВЕТ ЦЕНЫ при отклонении от нормы) + QR
// инвентаризация 14K (акт→заполнение→проведение→сверка) + Paloma «без
// остановки продаж». Наши профи-добавки сверх рынка:
//  1) подсказка последней цены закупки прямо в строке + алерт при
//     отклонении >20% (QR красит, мы ещё и подсказываем прошлую цену)
//  2) СЛЕПОЙ РЕЖИМ инвентаризации: счётчик не видит книжный остаток —
//     честный пересчёт (есть только у iiko в опциях, у остальных нет)
//  3) кнопка «Фото накладной» → ИИ-черновик (мост к Этапу 8)
import React, { useMemo, useState } from 'react';
import { inventoryDiff } from '../../../api/src/stock/stock.logic';

export type Money = number;
const fmt = (t: Money) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ ПРИХОД: VIEW-MODEL ═══════════════

export interface SupplyRow {
  productId: string; name: string; unit: string;
  qty: number;
  priceTenge: number;        // цена за единицу, тенге (ввод человеком)
  lastPriceTenge?: number;   // последняя цена закупки — подсказка
}

/** Отклонение цены от последней закупки (правило QR «цвет цены», порог наш). */
export function priceDeviation(row: SupplyRow): { pct: number; level: 'ok' | 'warn' | 'high' } | null {
  if (!row.lastPriceTenge || row.lastPriceTenge <= 0 || row.priceTenge <= 0) return null;
  const pct = Math.round(100 * (row.priceTenge - row.lastPriceTenge) / row.lastPriceTenge);
  const abs = Math.abs(pct);
  return { pct, level: abs > 50 ? 'high' : abs > 20 ? 'warn' : 'ok' };
}

export function supplyRowSum(row: SupplyRow): Money {
  return Math.round(row.qty * row.priceTenge * 100);
}

/**
 * Влияние новой закупочной цены на фудкост блюда — из макета:
 * «При цене конины 3 200 ₸/кг фудкост бешбармака станет 34% вместо 29% на прошлой цене».
 * Считается для позиций, где известен расход на порцию и цена продажи блюда.
 */
export interface FoodcostImpact {
  dishName: string;
  newPct: number;
  oldPct: number;
  worse: boolean;
}

export function foodcostImpact(
  row: SupplyRow,
  dish: { name: string; perPortion: number; salePriceTenge: number; otherCostTenge: number },
): FoodcostImpact | null {
  if (!row.lastPriceTenge || dish.salePriceTenge <= 0 || dish.perPortion <= 0) return null;
  const costNew = dish.otherCostTenge + row.priceTenge * dish.perPortion;
  const costOld = dish.otherCostTenge + row.lastPriceTenge * dish.perPortion;
  const newPct = Math.round(100 * costNew / dish.salePriceTenge);
  const oldPct = Math.round(100 * costOld / dish.salePriceTenge);
  return { dishName: dish.name, newPct, oldPct, worse: newPct > oldPct };
}

export function supplyDocTotals(rows: SupplyRow[]) {
  const total = rows.reduce((s, r) => s + supplyRowSum(r), 0);
  const alerts = rows
    .map((r) => ({ r, d: priceDeviation(r) }))
    .filter((x) => x.d && x.d.level !== 'ok')
    .map((x) => ({
      name: x.r.name, pct: x.d!.pct,
      text: `${x.r.name}: цена ${x.d!.pct > 0 ? 'выросла' : 'упала'} на ${Math.abs(x.d!.pct)}% (была ${x.r.lastPriceTenge} тг)`,
    }));
  return { total, positions: rows.filter((r) => r.qty > 0).length, alerts };
}

// ═══════════════ ПРИХОД: ЭКРАН ═══════════════

export function SupplyScreen(props: {
  suppliers: { id: string; name: string }[];
  initialRows: SupplyRow[];
  searchProducts: (q: string) => { productId: string; name: string; unit: string; lastPriceTenge?: number }[];
  onAiPhoto: () => void;   // фото накладной → ИИ-черновик (Этап 8)
  onSaveDraft: (rows: SupplyRow[], supplierId: string) => void;
  onPost: (rows: SupplyRow[], supplierId: string) => void;
  impacts?: FoodcostImpact[];    // влияние цен на фудкост блюд — из макета
}) {
  const [rows, setRows] = useState<SupplyRow[]>(props.initialRows);
  const [supplierId, setSupplierId] = useState(props.suppliers[0]?.id ?? '');
  const t = supplyDocTotals(rows);
  const upd = (i: number, patch: Partial<SupplyRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="supply-screen">
      <header className="doc-head">
        <h2>Принять поставку</h2>
        <button className="btn ai-btn" onClick={props.onAiPhoto}>📷 Фото накладной</button>
      </header>
      <div className="doc-meta">
        <label>Поставщик
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {props.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <table className="doc-table">
        <thead><tr><th>Товар</th><th>Кол-во</th><th>Цена, тг</th><th>Сумма</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const dev = priceDeviation(r);
            return (
              <tr key={i}>
                <td>{r.name} <em className="unit">{r.unit}</em></td>
                <td><input type="number" value={r.qty} onChange={(e) => upd(i, { qty: +e.target.value })} /></td>
                <td className={dev ? `price-${dev.level}` : ''}>
                  <input type="number" value={r.priceTenge} onChange={(e) => upd(i, { priceTenge: +e.target.value })} />
                  {r.lastPriceTenge != null && (
                    <em className="last-price">прошлая: {r.lastPriceTenge}</em>
                  )}
                </td>
                <td className="money">{fmt(supplyRowSum(r))}</td>
                <td><button onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {t.alerts.length > 0 && (
        <ul className="price-alerts">
          {t.alerts.map((a, i) => <li key={i} className="alert-warn">⚠ {a.text}</li>)}
        </ul>
      )}
      {!!props.impacts?.length && (
        <ul className="price-alerts">
          {props.impacts.map((im, i) => (
            <li key={i} className={im.worse ? 'alert-warn' : 'ok'}>
              {im.worse ? '📈' : '📉'} Фудкост «{im.dishName}» станет <b>{im.newPct}%</b> вместо {im.oldPct}% на прошлой цене
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 && (
        <div className="state-empty">
          <b>Товары не добавлены</b>
          <span>Найдите товар в поиске или загрузите накладную фотографией</span>
        </div>
      )}
      <footer className="doc-foot">
        <b className="money doc-total">{fmt(t.total)}</b>
        <span>{t.positions} позиций</span>
        <button className="btn" onClick={() => props.onSaveDraft(rows, supplierId)}>Черновик</button>
        <button className="btn btn-ok" disabled={t.positions === 0}
          onClick={() => props.onPost(rows, supplierId)}>Провести</button>
      </footer>
    </div>
  );
}

// ═══════════════ ИНВЕНТАРИЗАЦИЯ: VIEW-MODEL ═══════════════

export interface InvRow {
  productId: string; name: string; unit: string;
  bookAtStart: number;     // книжный на точке отсчёта (Paloma)
  movedAfterStart: number; // движения после старта
  counted: number | null;  // null = ещё не считали
  avgCostTenge: number;    // для деньги-оценки расхождения
}

export function invRowDiff(r: InvRow): { diff: number; money: Money } | null {
  if (r.counted === null) return null;
  // СЕМАНТИКА ВВОДА (суть Paloma «без остановки»): человек вводит «сколько
  // на полке СЕЙЧАС». Продажи после старта уже унесли товар с полки, значит
  // факт приводится к точке отсчёта: countedAtStart = counted − movedAfterStart.
  // Пример: книжный 100, продали 20 (moved −20), на полке 75 →
  // countedAtStart = 75−(−20) = 95 → недостача 5, а НЕ 25. (Поймано тестом.)
  const countedAtStart = r.counted - r.movedAfterStart;
  const { diff } = inventoryDiff({
    productId: r.productId, bookAtStart: r.bookAtStart,
    counted: countedAtStart, movedAfterStart: r.movedAfterStart,
  });
  return { diff, money: Math.round(diff * r.avgCostTenge * 100) };
}

/** Вывод по расхождению — формулировки из макета «Инвентаризация». */
export function shortageVerdict(shortageMoney: Money, normalShortage: Money): string {
  if (shortageMoney === 0) return 'излишков нет';
  return shortageMoney <= normalShortage
    ? 'в пределах нормы списаний'
    : 'выше обычного — проверьте вечернюю смену';
}

/** Подсказка к строке с расхождением — из макета. */
export function rowDiffHint(diff: number, isPacked: boolean): string | null {
  if (diff === 0) return null;
  if (isPacked && Math.abs(diff) <= 2) return 'бывает при пересчёте фасовки';
  return null;
}

export function invTotals(rows: InvRow[]) {
  let shortage = 0, surplus = 0, counted = 0;
  for (const r of rows) {
    const d = invRowDiff(r);
    if (!d) continue;
    counted++;
    if (d.money < 0) shortage += -d.money; else surplus += d.money;
  }
  return {
    counted, total: rows.length,
    shortageMoney: shortage, surplusMoney: surplus,
    progressPct: rows.length ? Math.round((100 * counted) / rows.length) : 0,
  };
}

/** Сортировка «сначала крупные расхождения в деньгах» — владелец видит,
 *  где утекло, первым делом (нет ни у кого: у всех алфавит/порядок ввода). */
export function sortByMoneyImpact(rows: InvRow[]): InvRow[] {
  return [...rows].sort((a, b) => {
    const da = invRowDiff(a), db = invRowDiff(b);
    return Math.abs(db?.money ?? 0) - Math.abs(da?.money ?? 0);
  });
}

// ═══════════════ ИНВЕНТАРИЗАЦИЯ: ЭКРАН ═══════════════

export function InventoryScreen(props: {
  startedAt: string;         // точка отсчёта (продажи не останавливаем!)
  rows: InvRow[];
  blindMode: boolean;        // СЛЕПОЙ РЕЖИМ: книжный скрыт от счётчика
  onCount: (productId: string, counted: number) => void;
  onToggleBlind: () => void;
  onPost: () => void;
  canPost: boolean;          // право stock.inventory (владелец/менеджер)
  scopeLabel?: string;       // «Кухня, склад и бар» — из макета
  counterName?: string;      // «считает Даулет»
  normalShortage?: Money;    // норма списаний для вердикта
}) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const t = invTotals(props.rows);
  const rows = useMemo(() => {
    const sorted = sortByMoneyImpact(props.rows);
    return onlyDiff ? sorted.filter((r) => (invRowDiff(r)?.diff ?? 0) !== 0) : sorted;
  }, [props.rows, onlyDiff]);

  return (
    <div className="inv-screen">
      <header className="doc-head">
        <div>
          <h2>Инвентаризация</h2>
          <span className="inv-note">
            {props.scopeLabel ?? 'Кухня, склад и бар'} · начата {props.startedAt}
            {props.counterName ? ` · считает ${props.counterName}` : ''}
            <br />Продажи можно не останавливать — факт приводится к точке отсчёта.
          </span>
        </div>
        <span className={`adm-badge ${props.blindMode ? 'adm-warn' : 'adm-ok'}`}>
          {props.blindMode ? 'Слепой пересчёт включён' : 'Слепой пересчёт выключен'}
        </span>
      </header>
      <div className="inv-controls">
        <label><input type="checkbox" checked={props.blindMode} onChange={props.onToggleBlind} />
          Слепой пересчёт (книжный скрыт)</label>
        <label><input type="checkbox" checked={onlyDiff} onChange={() => setOnlyDiff(!onlyDiff)} />
          Только расхождения</label>
        <div className="progress"><div style={{ width: `${t.progressPct}%` }} /></div>
        <span>{t.counted}/{t.total}</span>
      </div>
      <table className="doc-table">
        <thead><tr>
          <th>Товар</th>
          {!props.blindMode && <th>Книжный</th>}
          <th>Факт</th>
          <th>Расхождение</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const d = invRowDiff(r);
            return (
              <tr key={r.productId}>
                <td>{r.name} <em className="unit">{r.unit}</em></td>
                {!props.blindMode && <td>{r.bookAtStart + r.movedAfterStart}</td>}
                <td><input type="number" value={r.counted ?? ''}
                  placeholder="—"
                  onChange={(e) => props.onCount(r.productId, +e.target.value)} /></td>
                <td className={d ? (d.diff < 0 ? 'diff-neg' : d.diff > 0 ? 'diff-pos' : '') : ''}>
                  {d ? `${d.diff > 0 ? '+' : ''}${d.diff} (${fmt(d.money)})` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="state-empty">
          <b>{onlyDiff ? 'Расхождений нет' : 'Список пуст'}</b>
          <span>{onlyDiff ? 'Всё сошлось с книжными остатками 👌' : 'Добавьте товары для пересчёта'}</span>
        </div>
      )}
      <footer className="doc-foot">
        <span className="shortage">Недостача: <b>{fmt(t.shortageMoney)}</b>
          <em className="adm-mini"> · {shortageVerdict(t.shortageMoney, props.normalShortage ?? 0)}</em></span>
        <span className="surplus">Излишек: <b>{fmt(t.surplusMoney)}</b></span>
        <button className="btn btn-ok" disabled={!props.canPost || t.counted === 0}
          onClick={props.onPost}>Провести корректировку</button>
      </footer>
    </div>
  );
}

// apps/backoffice/src/reports/ReportScreens.tsx
// Шесть отчётных экранов. Каждый начинается с ответа на вопрос владельца.
import React, { useMemo, useState } from 'react';
import {
  salesReport, SaleRow, filterChecks, checksSummary, CheckRow, CheckFilters,
  pnlView, abcHint, AbcRowIn, salaryStatement, SalaryRowIn, Delta,
} from './repvm.ts';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

function DeltaBadge({ d }: { d: Delta }) {
  if (d.diffPct === null) return null;
  return <span className={`delta delta-${d.diffPct >= 0 ? 'up' : 'down'}`}>
    {d.diffPct >= 0 ? '↑' : '↓'}{Math.abs(d.diffPct)}%
  </span>;
}

// ═══ 1. ПРОДАЖИ ═══
export function SalesScreen({ cur, prev }: { cur: SaleRow[]; prev: SaleRow[] }) {
  const r = salesReport(cur, prev);
  return (
    <div className="report sales-report">
      <h2>Сколько я заработал?</h2>
      <div className="kpi-row">
        <div className="kpi"><span>Выручка</span><b className="money">{fmt(r.revenue.value)}</b><DeltaBadge d={r.revenue} /></div>
        <div className="kpi"><span>Чеки</span><b>{r.checks.value}</b><DeltaBadge d={r.checks} /></div>
        <div className="kpi"><span>Средний чек</span><b className="money">{fmt(r.avg.value)}</b><DeltaBadge d={r.avg} /></div>
      </div>
      <section>
        <h3>Час пик: {r.peakHour}:00–{r.peakHour + 1}:00</h3>
        <div className="bars-hours">
          {r.byHour.map((v, h) => (
            <div key={h} className={`bar ${h === r.peakHour ? 'bar-peak' : ''}`}
              style={{ height: `${Math.max(...r.byHour) ? Math.round((100 * v) / Math.max(...r.byHour)) : 0}%` }}
              title={`${h}:00 — ${fmt(v)}`} />
          ))}
        </div>
      </section>
      <section>
        <h3>По официантам</h3>
        <table><tbody>
          {r.byWaiter.map((w, i) => (
            <tr key={i}><td>{w.name}</td><td>{w.checks} чеков</td><td className="money">{fmt(w.total)}</td></tr>
          ))}
        </tbody></table>
      </section>
    </div>
  );
}

// ═══ 2. ЧЕКИ ═══
export function ChecksScreen({ rows }: { rows: CheckRow[] }) {
  const [f, setF] = useState<CheckFilters>({});
  const filtered = useMemo(() => filterChecks(rows, f), [rows, f]);
  const s = checksSummary(filtered);
  return (
    <div className="report checks-report">
      <h2>Что происходило на кассе?</h2>
      <div className="summary-row">
        <span>{s.count} чеков на <b className="money">{fmt(s.total)}</b></span>
        {s.withRemoved > 0 && <span className="warn">с удалениями: {s.withRemoved}</span>}
        {s.fiscalProblems > 0 && <span className="danger">проблемы фискализации: {s.fiscalProblems}</span>}
      </div>
      <div className="filters">
        <label><input type="checkbox" checked={!!f.onlyWithRemoved}
          onChange={() => setF({ ...f, onlyWithRemoved: !f.onlyWithRemoved })} /> Только с удалениями</label>
        <label><input type="checkbox" checked={!!f.onlyFiscalProblems}
          onChange={() => setF({ ...f, onlyFiscalProblems: !f.onlyFiscalProblems })} /> Проблемы фискализации</label>
        <input placeholder="№ чека" value={f.search ?? ''} onChange={(e) => setF({ ...f, search: e.target.value })} />
      </div>
      <table className="doc-table"><thead><tr>
        <th>№</th><th>Время</th><th>Сумма</th><th>Оплата</th><th>Фискал</th>
      </tr></thead><tbody>
        {filtered.map((c) => (
          <tr key={c.orderId} className={c.hasRemovedItems ? 'row-warn' : ''}>
            <td>{c.number}</td>
            <td>{c.closedAt.toTimeString().slice(0, 5)}</td>
            <td className="money">{fmt(c.total)}</td>
            <td>{c.paymentKinds.join('+')}</td>
            <td className={`fs-${c.fiscalStatus.toLowerCase()}`}>{c.fiscalStatus}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

// ═══ 3. P&L ═══
export function PnlScreen({ cur, prev }: {
  cur: { revenue: number; cogs: number; opex: number; tax: number; netProfit: number };
  prev: { revenue: number; cogs: number; opex: number; tax: number; netProfit: number };
}) {
  const v = pnlView(cur, prev);
  const Row = ({ label, d, strong, negative }: { label: string; d: Delta; strong?: boolean; negative?: boolean }) => (
    <tr className={strong ? 'row-strong' : ''}>
      <td>{label}</td>
      <td className="money">{negative ? '−' : ''}{fmt(Math.abs(d.value))}</td>
      <td><DeltaBadge d={d} /></td>
    </tr>
  );
  return (
    <div className="report pnl-report">
      <h2>Какая у меня прибыль?</h2>
      <table className="pnl-table"><tbody>
        <Row label="Выручка" d={v.revenue} />
        <Row label={`Себестоимость (фудкост ${v.foodcostPct.cur}%)`} d={v.cogs} negative />
        <Row label="Валовая прибыль" d={v.grossProfit} strong />
        <Row label="Операционные расходы" d={v.opex} negative />
        <Row label="Налог (упрощёнка 3%)" d={v.tax} negative />
        <Row label="Чистая прибыль после налога" d={v.netProfit} strong />
      </tbody></table>
      <p className="hint">Налог считается автоматически — такого нет ни в одной другой системе в КЗ.</p>
    </div>
  );
}

// ═══ 4. CASH FLOW ═══
export function CashFlowScreen({ inflow, outflow, byCategory }: {
  inflow: number; outflow: number;
  byCategory: { name: string; amount: number; direction: 'in' | 'out' }[];
}) {
  return (
    <div className="report cf-report">
      <h2>Куда ушли деньги?</h2>
      <div className="kpi-row">
        <div className="kpi"><span>Пришло</span><b className="money in">{fmt(inflow)}</b></div>
        <div className="kpi"><span>Ушло</span><b className="money out">{fmt(outflow)}</b></div>
        <div className="kpi"><span>Остаток движения</span><b className="money">{fmt(inflow - outflow)}</b></div>
      </div>
      <table className="doc-table"><tbody>
        {byCategory.sort((a, b) => b.amount - a.amount).map((c, i) => (
          <tr key={i}><td>{c.name}</td>
            <td className={`money ${c.direction}`}>{c.direction === 'out' ? '−' : '+'}{fmt(c.amount)}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

// ═══ 5. ABC ═══
export function AbcScreen({ rows }: { rows: AbcRowIn[] }) {
  return (
    <div className="report abc-report">
      <h2>Что кормит бизнес, а что балласт?</h2>
      <table className="doc-table"><thead><tr>
        <th>Блюдо</th><th>Выручка</th><th>Маржа</th><th>Что делать</th>
      </tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.productId} className={`abc-${r.revenueClass}${r.marginClass}`}>
            <td>{r.name}</td>
            <td className={`cls cls-${r.revenueClass}`}>{r.revenueClass}</td>
            <td className={`cls cls-${r.marginClass}`}>{r.marginClass}</td>
            <td className="hint-cell">{abcHint(r)}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

// ═══ 6. ЗАРПЛАТА ═══
export function SalaryScreen({ rows, periodLabel }: { rows: SalaryRowIn[]; periodLabel: string }) {
  const s = salaryStatement(rows);
  return (
    <div className="report salary-report">
      <h2>Сколько платить сотрудникам?</h2>
      <p>{periodLabel}</p>
      <table className="doc-table"><thead><tr>
        <th>Сотрудник</th><th>Оклад</th><th>Часы</th><th>% продаж</th><th>Авансы</th><th>К выплате</th>
      </tr></thead><tbody>
        {s.rows.map((r) => (
          <tr key={r.userId}>
            <td>{r.name} <em>{r.role}</em></td>
            <td className="money">{fmt(r.baseSalary)}</td>
            <td className="money">{fmt(r.hourly)}</td>
            <td className="money">{fmt(r.salesPct)}</td>
            <td className="money">−{fmt(r.advances)}</td>
            <td className="money strong">{fmt(r.toPay)}</td>
          </tr>
        ))}
      </tbody></table>
      <footer className="doc-foot">
        <span>Начислено: <b className="money">{fmt(s.totalAccrued)}</b></span>
        <span>К выплате: <b className="money">{fmt(s.totalToPay)}</b></span>
      </footer>
    </div>
  );
}

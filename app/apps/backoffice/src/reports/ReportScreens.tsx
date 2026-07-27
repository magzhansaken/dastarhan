// apps/backoffice/src/reports/ReportScreens.tsx
// Шесть отчётных экранов. Каждый начинается с ответа на вопрос владельца.
import React, { useMemo, useState } from 'react';
import {
  salesReport, SaleRow, filterChecks, checksSummary, CheckRow, CheckFilters,
  pnlView, abcHint, abcRole, abcGroup, ABC_GROUP, AbcRowIn,
  salaryStatement, SalaryRowIn, Delta,
  reportSubtitle, peakAdvice, CHECK_FILTERS, CHECK_EMPTY,
  PNL_LINES, PNL_VIEW, PNL_PERIODS, pctOfRevenue, pnlCellText,
} from './report.viewmodels';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

function DeltaBadge({ d }: { d: Delta }) {
  if (d.diffPct === null) return null;
  return <span className={`delta delta-${d.diffPct >= 0 ? 'up' : 'down'}`}>
    {d.diffPct >= 0 ? '↑' : '↓'}{Math.abs(d.diffPct)}%
  </span>;
}

// ═══ 1. ПРОДАЖИ ═══
export function SalesScreen({ cur, prev, periodLabel, daysCount, locationName }: {
  cur: SaleRow[]; prev: SaleRow[];
  periodLabel?: string; daysCount?: number; locationName?: string;
}) {
  const r = salesReport(cur, prev);
  const advice = peakAdvice(r.byHour, r.peakHour);
  return (
    <div className="report sales-report">
      <h2>Сколько я заработал?</h2>
      <p className="inv-note">{reportSubtitle(['Продажи', periodLabel,
        daysCount ? `${daysCount} дня` : null, locationName ? `точка ${locationName}` : null])}</p>
      <div className="kpi-row">
        <div className="kpi"><span>Выручка</span><b className="money">{fmt(r.revenue.value)}</b><DeltaBadge d={r.revenue} /></div>
        <div className="kpi"><span>Чеки</span><b>{r.checks.value}</b><DeltaBadge d={r.checks} /></div>
        <div className="kpi"><span>Средний чек</span><b className="money">{fmt(r.avg.value)}</b><DeltaBadge d={r.avg} /></div>
      </div>
      <section>
        <h3>Час пик: {r.peakHour}:00–{r.peakHour + 1}:00{advice ? ` — ${advice}` : ''}</h3>
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
export function ChecksScreen({ rows, periodLabel, cashiersCount }: {
  rows: CheckRow[]; periodLabel?: string; cashiersCount?: number;
}) {
  const [f, setF] = useState<CheckFilters>({});
  const filtered = useMemo(() => filterChecks(rows, f), [rows, f]);
  const s = checksSummary(filtered);
  const all = checksSummary(rows);
  return (
    <div className="report checks-report">
      <h2>Что происходило на кассе?</h2>
      <p className="inv-note">{reportSubtitle(['Чеки', periodLabel,
        `${rows.length} чеков`, cashiersCount ? `${cashiersCount} кассира` : null])}</p>
      <div className="summary-row">
        <span>{s.count} чеков на <b className="money">{fmt(s.total)}</b></span>
        {s.withRemoved > 0
          ? <span className="warn">с удалениями: {s.withRemoved}</span>
          : <span className="ok">{CHECK_EMPTY.noRemovals.ru}</span>}
        {s.fiscalProblems > 0
          ? <span className="danger">проблемы фискализации: {s.fiscalProblems}</span>
          : <span className="ok">{CHECK_EMPTY.allSent.ru}</span>}
      </div>
      <div className="filters">
        <label><input type="checkbox" checked={!!f.onlyWithRemoved}
          onChange={() => setF({ ...f, onlyWithRemoved: !f.onlyWithRemoved })} /> {CHECK_FILTERS.removed.ru}</label>
        <label><input type="checkbox" checked={!!f.onlyFiscalProblems}
          onChange={() => setF({ ...f, onlyFiscalProblems: !f.onlyFiscalProblems })} /> {CHECK_FILTERS.fiscal.ru}</label>
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
      {filtered.length === 0 && (
        <div className="state-empty">
          <b>Ничего не найдено</b>
          <span>{all.count > 0 ? 'Снимите фильтры, чтобы увидеть все чеки' : 'За этот период чеков не было'}</span>
        </div>
      )}
    </div>
  );
}

// ═══ 3. P&L — ТОЧНО по макету «Бэк-офис — Прибыль» ═══

export function ProfitScreen(props: {
  values: Record<string, number>;      // ключи из PNL_LINES
  prevValues?: Record<string, number>;
  periodKey?: 'month' | 'prev' | 'quarter';
  foodcostPct?: number;
  staffCount?: number;
  rentNote?: string;                   // «Абая 52, 140 м²»
  writeoffNote?: string;               // «вдвое выше обычного»
  onPeriod?: (k: string) => void;
  onExport?: () => void;
  locationName?: string;                       // «Точка» — фильтр из макета
  insights?: { text: string; link?: boolean }[]; // «Что повлияло на прибыль»
}) {
  const [mode, setMode] = useState<'money' | 'pct'>('money');
  const period = PNL_PERIODS.find((p) => p.key === (props.periodKey ?? 'month'))!;
  const revenue = props.values.revenue ?? 0;
  const noteFor = (key: string, base: string) => {
    if (key === 'cogs' && props.foodcostPct != null) return `${base} ${props.foodcostPct}%`;
    if (key === 'salary' && props.staffCount != null) return `${props.staffCount} человек, ${base}`;
    if (key === 'rent' && props.rentNote) return props.rentNote;
    if (key === 'writeoff' && props.writeoffNote) return props.writeoffNote;
    return base;
  };

  return (
    <div className="report pnl-report">
      <header className="doc-head" style={{ padding: 0 }}>
        <div>
          <h2>Какая у меня прибыль?</h2>
          <span className="inv-note">{period.subtitle}{props.locationName ? ` · Точка ${props.locationName}` : ''}</span>
        </div>
        <div className="ch-badges">
          {props.onPeriod && (
            <div className="lang-switch">
              {PNL_PERIODS.map((p) => (
                <button key={p.key} className={p.key === period.key ? 'on' : ''}
                  onClick={() => props.onPeriod!(p.key)}>{p.title}</button>
              ))}
            </div>
          )}
          <div className="lang-switch">
            <button className={mode === 'money' ? 'on' : ''} onClick={() => setMode('money')}>₸</button>
            <button className={mode === 'pct' ? 'on' : ''} onClick={() => setMode('pct')}>%</button>
          </div>
          {props.onExport && (
            <button className="btn btn-sm" onClick={props.onExport}>{PNL_VIEW.exportXls.ru}</button>
          )}
        </div>
      </header>

      <p className="hint">{mode === 'money' ? PNL_VIEW.inPct.ru : PNL_VIEW.inTenge.ru} — переключатель справа</p>

      <table className="pnl-table"><thead><tr>
        <th>Строка</th>
        <th style={{ textAlign: 'right' }}>{mode === 'pct' ? '% выручки' : 'Тенге'}</th>
        <th style={{ textAlign: 'right' }}>{period.compare}</th>
      </tr></thead><tbody>
        {PNL_LINES.map((l) => {
          const v = props.values[l.key] ?? 0;
          const pv = props.prevValues?.[l.key];
          const d = pv != null && pv !== 0 ? Math.round(100 * (v - pv) / Math.abs(pv)) : null;
          return (
            <tr key={l.key} className={l.strong ? 'row-strong' : ''}>
              <td>{l.title}
                {noteFor(l.key, l.note) && <em className="last-price">{noteFor(l.key, l.note)}</em>}
              </td>
              <td className="money" style={{ textAlign: 'right' }}>
                {l.sign === -1 && v > 0 ? '−' : ''}{pnlCellText(v, revenue, mode, fmt)}
              </td>
              <td style={{ textAlign: 'right' }}>
                {d !== null && (
                  <span className={`delta delta-${d >= 0 ? 'up' : 'down'}`}>
                    {d >= 0 ? '↑' : '↓'}{Math.abs(d)}%
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody></table>

      {!!props.insights?.length && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Что повлияло на прибыль</h3>
          <ul className="price-alerts" style={{ margin: 0 }}>
            {props.insights.map((x, i) => (
              <li key={i} className="alert-warn">
                {x.text}
                {x.link && <a className="card-link" href="#"> Отчёт →</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="hint">{PNL_VIEW.taxAuto.ru} — такого нет ни в одной другой системе в Казахстане. {PNL_VIEW.forAcc.ru} в один клик.</p>
    </div>
  );
}

// ═══ 3b. P&L (компактный) ═══
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
export function AbcScreen({ rows, periodLabel, positionsCount }: {
  rows: AbcRowIn[]; periodLabel?: string; positionsCount?: number;
}) {
  const groups: (keyof typeof ABC_GROUP)[] = ['feeds', 'hold', 'ballast'];
  return (
    <div className="report abc-report">
      <h2>Что кормит бизнес, а что балласт?</h2>
      <p className="inv-note">{reportSubtitle(['ABC-анализ меню', periodLabel,
        positionsCount ? `${positionsCount} позиция` : null])}</p>
      {groups.map((g) => {
        const list = rows.filter((r) => abcGroup(r) === g);
        if (!list.length) return null;
        return (
          <section key={g}>
            <h3 className="label-mono">{ABC_GROUP[g].ru}</h3>
            <table className="doc-table"><thead><tr>
              <th>Блюдо</th><th>Выручка</th><th>Маржа</th><th>Роль</th><th>Что делать</th>
            </tr></thead><tbody>
              {list.map((r) => (
                <tr key={r.productId} className={`abc-${r.revenueClass}${r.marginClass}`}>
                  <td>{r.name}</td>
                  <td className={`cls cls-${r.revenueClass}`}>{r.revenueClass}</td>
                  <td className={`cls cls-${r.marginClass}`}>{r.marginClass}</td>
                  <td className="adm-mini">{abcRole(r)}</td>
                  <td className="hint-cell">{abcHint(r)}</td>
                </tr>
              ))}
            </tbody></table>
          </section>
        );
      })}
      {rows.length === 0 && (
        <div className="state-empty">
          <b>Продаж за период не было</b>
          <span>Выберите другой период или точку</span>
        </div>
      )}
    </div>
  );
}

// ═══ 6. ЗАРПЛАТА ═══
export function SalaryScreen({ rows, periodLabel, payoutDate, revenueSharePct }: {
  rows: SalaryRowIn[]; periodLabel: string; payoutDate?: string; revenueSharePct?: number;
}) {
  const s = salaryStatement(rows);
  return (
    <div className="report salary-report">
      <h2>Сколько платить сотрудникам?</h2>
      <p className="inv-note">{reportSubtitle([`Ведомость за ${periodLabel}`,
        `${rows.length} человек`, payoutDate ? `выплата ${payoutDate}` : null])}</p>
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
        <span>К выплате: <b className="money">{fmt(s.totalToPay)}</b>
          {revenueSharePct != null && <em className="adm-mini"> · {revenueSharePct}% от выручки</em>}</span>
      </footer>
    </div>
  );
}

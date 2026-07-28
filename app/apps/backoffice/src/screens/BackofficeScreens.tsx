// apps/backoffice/src/screens/BackofficeScreens.tsx
// Три ключевых экрана бэк-офиса. Язык владельца, навигация по задачам.
import React, { useMemo, useState } from 'react';
import {
  buildNav, dashCards, DashInput, TcLine, lossPct, liveCost, tcErrors,
  SupplyLineVm, supplyTotals, supplyErrors, onboardingSteps, onboardingProgress,
  foodcostLevel, FOODCOST_LEVEL, stockForecast, monthlyMargin,
} from '../viewmodels';
import { CostContext } from '../../../../packages/shared/src/menu/cost.service';

const fmt = (t: number) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══ Словарь бэк-офиса — из макета «Бэк-офис — Дашборд» Claude Design ═══
export const BT = {
  navToday:  { ru: 'Сегодня', kk: 'Бүгін' },
  navWork:   { ru: 'Работа', kk: 'Жұмыс' },
  navMoney:  { ru: 'Деньги', kk: 'Ақша' },
  navGuests: { ru: 'Гости', kk: 'Қонақтар' },
  howItGoes: { ru: 'Как идут дела', kk: 'Жағдай қалай' },
  salesChecks:{ ru: 'Продажи и чеки', kk: 'Сатылым және чектер' },
  shifts:    { ru: 'Смены', kk: 'Ауысымдар' },
  supply:    { ru: 'Принять поставку', kk: 'Жеткізілімді қабылдау' },
  inventory: { ru: 'Инвентаризация', kk: 'Түгендеу' },
  menuTech:  { ru: 'Меню и техкарты', kk: 'Мәзір және техкарталар' },
  staff:     { ru: 'Сотрудники', kk: 'Қызметкерлер' },
  profit:    { ru: 'Прибыль', kk: 'Пайда' },
  cashflow:  { ru: 'Куда ушли деньги', kk: 'Ақша қайда кетті' },
  billing:   { ru: 'Оплата и тариф', kk: 'Төлем және тариф' },
  owner:     { ru: 'Владелец', kk: 'Иесі' },
  day:       { ru: 'Сегодня', kk: 'Бүгін' },
  week:      { ru: 'Неделя', kk: 'Апта' },
  month:     { ru: 'Месяц', kk: 'Ай' },
  shiftOpen: { ru: 'Смена открыта', kk: 'Ауысым ашық' },
  report:    { ru: 'Отчёт за день', kk: 'Күндік есеп' },
  revenue:   { ru: 'Выручка', kk: 'Түсім' },
  checks:    { ru: 'Чеки', kk: 'Чектер' },
  avg:       { ru: 'Средний чек', kk: 'Орташа чек' },
  attention: { ru: 'Требует внимания', kk: 'Назар аударыңыз' },
  later:     { ru: 'Потом', kk: 'Кейін' },
  allGood:   { ru: 'Всё спокойно 👌', kk: 'Бәрі жақсы 👌' },
  feeds:     { ru: 'Что кормит бизнес, а что балласт', kk: 'Бизнесті не асырайды' },
  allReports:{ ru: 'Все отчёты →', kk: 'Барлық есептер →' },
} as const;

export type BoLang = 'ru' | 'kk';
export const bt = (k: keyof typeof BT, lang: BoLang = 'ru') => BT[k][lang];

/** Оболочка бэк-офиса: боковая навигация по задачам + шапка (макет). */
export function BackofficeShell(props: {
  sections: { id: string; title: string; tasks: { id: string; title: string; route: string; locked?: boolean }[] }[];
  activeTaskId: string;
  accountName: string;
  locationsLabel?: string;
  userName: string;
  userRole?: string;
  lang?: BoLang;
  onTask: (id: string) => void;
  children: React.ReactNode;
}) {
  const lang = props.lang ?? 'ru';
  return (
    <div className="bo-layout">
      <nav className="bo-nav">
        <div className="bo-logo">Dastarhan</div>
        <div className="bo-section">
          <h4>{lang === 'kk' ? 'Аккаунт' : 'Аккаунт'}</h4>
          <div className="bo-task">{props.accountName}</div>
          {props.locationsLabel && <div className="staff-note" style={{ padding: '0 12px' }}>{props.locationsLabel}</div>}
        </div>
        {props.sections.map((s) => (
          <div className="bo-section" key={s.id}>
            <h4>{s.title}</h4>
            {s.tasks.map((task) => (
              <a key={task.id}
                className={`bo-task ${props.activeTaskId === task.id ? 'on' : ''}`}
                onClick={() => props.onTask(task.id)}>
                <span>{task.title}</span>
                {task.locked && <span className="lock-badge">🔒</span>}
              </a>
            ))}
          </div>
        ))}
        <div className="bo-section">
          <h4>{props.userRole ?? bt('owner', lang)}</h4>
          <div className="bo-task">{props.userName}</div>
        </div>
      </nav>
      <main>{props.children}</main>
    </div>
  );
}

// ═══════════════ ДАШБОРД «КАК ИДУТ ДЕЛА» ═══════════════
export function Dashboard({ data, lang = 'ru', period = 'day', onPeriod, shiftInfo, onReport }: {
  data: DashInput; lang?: BoLang;
  period?: 'day' | 'week' | 'month';
  onPeriod?: (p: 'day' | 'week' | 'month') => void;
  shiftInfo?: string;          // «Смена открыта · Айгерим» — из макета
  onReport?: () => void;       // «Отчёт за день» — из макета
}) {
  const c = dashCards(data);
  return (
    <>
    <header className="doc-head">
      <div>
        <h2>{bt('howItGoes', lang)}</h2>
        {shiftInfo && <span className="inv-note">{bt('shiftOpen', lang)} · {shiftInfo}</span>}
      </div>
      <div className="ch-badges">
        {onPeriod && (
          <div className="lang-switch">
            {(['day','week','month'] as const).map((p) => (
              <button key={p} className={period === p ? 'on' : ''} onClick={() => onPeriod(p)}>
                {bt(p === 'day' ? 'day' : p === 'week' ? 'week' : 'month', lang)}
              </button>
            ))}
          </div>
        )}
        {onReport && <button className="btn btn-sm" onClick={onReport}>{bt('report', lang)}</button>}
      </div>
    </header>
    <div className="dash">
      <section className="card card-revenue">
        <h3>{bt('revenue', lang)}</h3>
        <b className="money-xl">{fmt(c.revenue.value)}</b>
        {c.revenue.diffPct !== null && (
          <span className={`diff diff-${c.revenue.tone}`}>
            {c.revenue.diffPct >= 0 ? '↑' : '↓'} {Math.abs(c.revenue.diffPct)}% ко вчера
          </span>
        )}
      </section>
      <section className="card">
        <h3>{bt('checks', lang)}</h3>
        <b>{c.checks.value}</b>
        <span>{bt('avg', lang)} {fmt(c.checks.avg)}</span>
      </section>
      <section className="card card-attention">
        <h3>{bt('attention', lang)}</h3>
        {c.attention.length === 0 && <p className="ok">{bt('allGood', lang)}</p>}
        <ul>
          {c.attention.map((a, i) => (
            <li key={i} className={`alert alert-${a.severity.toLowerCase()}`}>{a.text}</li>
          ))}
        </ul>
      </section>
    </div>
    </>
  );
}

// ═══════════════ РЕДАКТОР ТЕХКАРТЫ (живой фудкост) ═══════════════
export function TechCardEditor(props: {
  productName: string; salePrice: number; ctx: CostContext;
  initial: TcLine[]; outputQty: number;
  portionsPerDay?: number;        // для прогноза «хватит на N дней» — из макета
  portionsPerMonth?: number;      // для «на 118 порциях в месяц это …»
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
        {/* ЖИВОЙ фудкост с тремя уровнями — из макета: В норме / На границе / Дорого */}
        <div className={`foodcost foodcost-${foodcostLevel(live.foodcostPct)}`}>
          <span>Себестоимость {fmt(live.portionCost)}</span>
          <b>Фудкост {live.foodcostPct}% · {FOODCOST_LEVEL[foodcostLevel(live.foodcostPct)].ru}</b>
          <span>Маржа {fmt(live.margin)}
            {props.portionsPerMonth
              ? ` · на ${props.portionsPerMonth} порциях в месяц это ${fmt(monthlyMargin(live.margin, props.portionsPerMonth))} до расходов на зал и зарплату`
              : ''}</span>
        </div>
      </header>
      <table className="tc-table">
        <thead><tr><th>Продукт</th><th>Брутто, г/мл</th><th>Нетто</th><th>Потери</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}
                {l.kind && <em className="unit"> · {l.kind}</em>}
                {l.stockQty != null && (
                  <em className="last-price">на складе {l.stockQty} {l.unit ?? ''}
                    {(() => {
                      const f = stockForecast(l.stockQty!, l.brutto / 1000, props.portionsPerDay ?? 0);
                      return f.daysLeft != null ? ` · хватит на ${f.daysLeft} дней` : '';
                    })()}
                  </em>
                )}
                {l.note && <em className="staff-note">{l.note}</em>}
              </td>
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

// ═══════════════ ТЕХКАРТА: ТЕКСТЫ ═══════════════
// Экран отвечает на вопрос «сколько я зарабатываю на этом блюде»,
// а не «из чего оно состоит». Состав — средство, деньги — цель.

export const TECHCARD_COPY = {
  breadcrumb: (category: string) => `Меню и техкарты · ${category}`,
  toStopList: 'В стоп-лист',
  duplicate: 'Дублировать',
  save: 'Сохранить техкарту',

  output: 'Выход',
  station: 'Цех',
  menuPrice: 'Цена в меню',
  // Полуфабрикат вкладывается как компонент: зирвак готовится партией
  // и раскладывается по порциям — считать его каждый раз заново нельзя
  nestSemi: 'Вложить полуфабрикат',

  howTo: 'Как готовить',
  howToNote: (date: string, who: string) =>
    `Видит повар на KDS по кнопке «Как готовить». Обновлено ${date}, ${who}.`,

  margin: 'Наценка с порции',
  // Прогноз в порциях, а не в килограммах: повар думает порциями,
  // и «хватит на 12 порций» понятнее, чем «осталось 1,4 кг»
  enoughFor: 'Хватит продуктов на',
  orderMore: (product: string) => `Заказать ${product}`,

  revenue: 'Дало выручки',
  menuPlace: 'Место в меню',
  placeByMoney: (n: number) => `${n}-е по деньгам`,
} as const;

/** На сколько порций хватит остатка по самому дефицитному компоненту. */
export function portionsLeft(
  lines: { componentId: string; bruttoQty: number }[],
  balances: Map<string, number>,
): { portions: number; scarcest: string | null } {
  let min = Infinity;
  let scarcest: string | null = null;
  for (const l of lines) {
    if (l.bruttoQty <= 0) continue;
    const have = balances.get(l.componentId) ?? 0;
    const p = Math.floor(have / l.bruttoQty);
    if (p < min) { min = p; scarcest = l.componentId; }
  }
  return { portions: min === Infinity ? 0 : Math.max(0, min), scarcest };
}

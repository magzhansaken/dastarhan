// apps/pos/src/ui/screens/ShiftScreens.tsx
// ЭКРАНЫ СМЕН — ТОЧНО по макету «Касса — Вход, зал и смены» (03 и 04).
// Открытие смены с разменом и закрытие с живым пересчётом наличных.
// Все подписи, подсказки и состав расчёта взяты из макета.
import React, { useState } from 'react';
import { formatMoney, tenderPress } from '../viewmodels';
import { Lang, t as T, LangToggle } from './PosScreens';

export type Money = number;

// ═══════════════ СЛОВАРЬ (из макета) ═══════════════

export const ST = {
  openTitle:   { ru: 'Открытие смены', kk: 'Ауысымды ашу' },
  openQ:       { ru: 'Сколько денег в ящике на старте?', kk: 'Бастапқыда жәшікте қанша ақша бар?' },
  openHint:    { ru: 'Это размен — с него даёте сдачу. В закрытии смены он вычтется автоматически.',
                 kk: 'Бұл ұсақ ақша — одан қайтарым бересіз. Ауысым жабылғанда автоматты түрде шегеріледі.' },
  floatLabel:  { ru: 'Размен на смену', kk: 'Ауысымға ұсақ ақша' },
  openBtn:     { ru: 'Открыть смену', kk: 'Ауысымды ашу' },
  prevShift:   { ru: 'Прошлая смена', kk: 'Өткен ауысым' },
  prevOk:      { ru: 'Прошлая смена закрыта без расхождений', kk: 'Өткен ауысым айырмасыз жабылды' },
  fiscalOk:    { ru: 'Webkassa на связи, смена будет фискальной', kk: 'Webkassa байланыста, ауысым фискалды болады' },
  stopNote:    { ru: 'Стоп-лист', kk: 'Стоп-тізім' },
  collectYd:   { ru: 'Инкассация вчера', kk: 'Кеше инкассация' },

  closeTitle:  { ru: 'Закрытие смены', kk: 'Ауысымды жабу' },
  calculated:  { ru: 'Что система насчитала', kk: 'Жүйе есептегені' },
  expected:    { ru: 'Должно быть в ящике', kk: 'Жәшікте болуы тиіс' },
  countPrompt: { ru: 'Пересчитайте и введите факт', kk: 'Қайта санап, нақты соманы енгізіңіз' },
  countedLbl:  { ru: 'Фактически в ящике', kk: 'Жәшіктегі нақты сома' },
  recount:     { ru: 'Пересчитать', kk: 'Қайта санау' },
  closeBtn:    { ru: 'Закрыть смену · Z-отчёт', kk: 'Ауысымды жабу · Z-есеп' },
  closeDiff:   { ru: 'Закрыть с расхождением', kk: 'Айырмамен жабу' },
  discrepancy: { ru: 'Расхождение', kk: 'Айырма' },
  surplus:     { ru: 'Излишек', kk: 'Артық' },
  shortage:    { ru: 'Недостача', kk: 'Жетіспеушілік' },
  enterHint:   { ru: 'Введите сумму — расхождение посчитаем сами.', kk: 'Соманы енгізіңіз — айырманы өзіміз санаймыз.' },
  matchHint:   { ru: 'Всё сходится. Можно закрывать смену и снимать Z-отчёт.',
                 kk: 'Бәрі сәйкес келеді. Ауысымды жауып, Z-есепті алуға болады.' },

  // строки расчёта — из макета
  lineFloat:   { ru: 'Размен на старте', kk: 'Бастапқы ұсақ ақша' },
  lineCash:    { ru: 'Наличная выручка', kk: 'Қолма-қол түсім' },
  lineCourier: { ru: 'Сдача курьерам', kk: 'Курьерлерге тапсыру' },
  lineRefund:  { ru: 'Возвраты наличными', kk: 'Қолма-қол қайтарымдар' },
  lineCollect: { ru: 'Инкассация в смену', kk: 'Ауысымдағы инкассация' },
  notDone:     { ru: 'не проводилась', kk: 'жүргізілмеді' },
} as const;

export const st = (k: keyof typeof ST, lang: Lang = 'ru') => ST[k][lang];

/** Быстрые суммы размена с подсказками — из макета. */
export const FLOAT_PRESETS = [
  { value: 20000_00, note: { ru: 'мало для вечера', kk: 'кешке аз' } },
  { value: 40000_00, note: { ru: 'обычный размен', kk: 'қалыпты ұсақ ақша' } },
  { value: 60000_00, note: { ru: 'если много наличных', kk: 'қолма-қол көп болса' } },
] as const;

// ═══════════════ РАСЧЁТ ЗАКРЫТИЯ ═══════════════

export interface ShiftCloseInput {
  openingFloat: Money;      // размен на старте
  cashRevenue: Money;       // наличная выручка
  courierHandover: Money;   // сдача курьерами (приход)
  cashRefunds: Money;       // возвраты наличными (расход)
  collections: Money;       // инкассация в смену (расход)
}

/** Сколько должно быть в ящике — формула из макета. */
export function expectedCash(i: ShiftCloseInput): Money {
  return i.openingFloat + i.cashRevenue + i.courierHandover - i.cashRefunds - i.collections;
}

/** Расхождение: >0 излишек, <0 недостача. */
export function shiftDiff(counted: Money, i: ShiftCloseInput): Money {
  return counted - expectedCash(i);
}

/** Подпись расхождения — из макета: «Излишек» / «Недостача» / «Расхождение». */
export function diffCaption(diff: number, lang: Lang = 'ru'): string {
  if (diff === 0) return st('discrepancy', lang);
  return diff > 0 ? st('surplus', lang) : st('shortage', lang);
}

/** Подсказка под расхождением. */
export function diffHint(counted: Money | null, diff: number, lang: Lang = 'ru'): string {
  if (counted === null) return st('enterHint', lang);
  return diff === 0 ? st('matchHint', lang) : st('enterHint', lang);
}

/** Надпись на кнопке закрытия — меняется при расхождении (правило макета). */
export function closeButtonLabel(counted: Money | null, diff: number, lang: Lang = 'ru'): string {
  if (counted === null || diff === 0) return st('closeBtn', lang);
  return st('closeDiff', lang);
}

// ═══════════════ ЭКРАН ОТКРЫТИЯ СМЕНЫ ═══════════════

export function ShiftOpenScreen(props: {
  cashierName: string;
  time: string;                       // «08:14»
  date?: string;                      // «24 июля»
  prevShiftDate?: string;
  prevShiftOk?: boolean;
  fiscalReady?: boolean;
  stopListNote?: string;              // «манты и казы — кухня отметила вчера»
  lastCollection?: { amount: Money; note: string };
  lang?: Lang;
  onLang?: (l: Lang) => void;
  onOpen: (floatAmount: Money) => void;
}) {
  const lang = props.lang ?? 'ru';
  const [floatTenge, setFloat] = useState(40000);

  return (
    <div className="shift-screen">
      <header className="pay-top">
        <div className="pay-ctx">
          <b>{st('openTitle', lang)}</b>
          <span>{props.cashierName} · {T('cashier', lang)} · {props.time}</span>
        </div>
        {props.onLang && <LangToggle lang={lang} onChange={props.onLang} />}
      </header>

      <section className="shift-ask">
        <h2>{st('openQ', lang)}</h2>
        <p className="hint">{st('openHint', lang)}</p>
      </section>

      <div className="quick-notes">
        {FLOAT_PRESETS.map((p) => (
          <button key={p.value} className={`btn note ${floatTenge * 100 === p.value ? 'on' : ''}`}
            onClick={() => setFloat(p.value / 100)}>
            <span>{formatMoney(p.value)}
              <em style={{ display: 'block', fontStyle: 'normal', fontSize: 12, opacity: .7 }}>
                {p.note[lang]}</em>
            </span>
          </button>
        ))}
      </div>

      <div className="label-mono">{st('floatLabel', lang)}</div>
      <div className="tendered money">{formatMoney(floatTenge * 100)}</div>
      <div className="numpad">
        {['1','2','3','4','5','6','7','8','9','C','0','del'].map((k) => (
          <button key={k} className="btn numpad-key"
            onClick={() => setFloat(tenderPress(floatTenge, k))}>{k === 'del' ? '⌫' : k}</button>
        ))}
      </div>

      <ul className="shift-checks">
        {props.prevShiftOk && <li className="shift-ok">✓ {st('prevOk', lang)}</li>}
        {props.fiscalReady && <li className="shift-ok">✓ {st('fiscalOk', lang)}</li>}
        {props.stopListNote && <li className="shift-warn">{st('stopNote', lang)}: {props.stopListNote}</li>}
      </ul>

      <button className="btn btn-ok cr-big" onClick={() => props.onOpen(floatTenge * 100)}>
        {st('openBtn', lang)} · {formatMoney(floatTenge * 100)}
      </button>

      {props.lastCollection && (
        <section className="shift-prev">
          <div className="label-mono">{st('prevShift', lang)}{props.prevShiftDate ? ` · ${props.prevShiftDate}` : ''}</div>
          <div className="pay-breakdown">
            <div><span>{st('collectYd', lang)}</span>
              <span className="money">{formatMoney(props.lastCollection.amount)}</span></div>
          </div>
          <p className="hint">{props.lastCollection.note}</p>
        </section>
      )}
    </div>
  );
}

// ═══════════════ ЭКРАН ЗАКРЫТИЯ СМЕНЫ ═══════════════

export function ShiftCloseScreen(props: {
  shiftRange: string;                 // «08:14 — 23:52»
  cashierName: string;
  checksCount: number;
  input: ShiftCloseInput;
  notes?: Partial<Record<keyof ShiftCloseInput, string>>;  // пояснения из макета
  lang?: Lang;
  onLang?: (l: Lang) => void;
  onClose: (counted: Money, diff: Money) => void;
}) {
  const lang = props.lang ?? 'ru';
  const [countedTenge, setCounted] = useState<number | null>(null);
  const exp = expectedCash(props.input);
  const counted = countedTenge === null ? null : countedTenge * 100;
  const diff = counted === null ? 0 : shiftDiff(counted, props.input);

  const lines: { key: keyof ShiftCloseInput; label: string; value: Money; sign: 1 | -1 }[] = [
    { key: 'openingFloat',    label: st('lineFloat', lang),   value: props.input.openingFloat,    sign: 1 },
    { key: 'cashRevenue',     label: st('lineCash', lang),    value: props.input.cashRevenue,     sign: 1 },
    { key: 'courierHandover', label: st('lineCourier', lang), value: props.input.courierHandover, sign: 1 },
    { key: 'cashRefunds',     label: st('lineRefund', lang),  value: props.input.cashRefunds,     sign: -1 },
    { key: 'collections',     label: st('lineCollect', lang), value: props.input.collections,     sign: -1 },
  ];

  return (
    <div className="shift-screen">
      <header className="pay-top">
        <div className="pay-ctx">
          <b>{st('closeTitle', lang)}</b>
          <span>{props.shiftRange} · {props.cashierName} · {props.checksCount} чека</span>
        </div>
        {props.onLang && <LangToggle lang={lang} onChange={props.onLang} />}
      </header>

      <div className="label-mono">{st('calculated', lang)}</div>
      <ul className="shift-lines">
        {lines.map((l) => (
          <li key={l.key} className={l.value === 0 ? 'shift-zero' : ''}>
            <span>{l.label}
              {props.notes?.[l.key] && <em>{props.notes[l.key]}</em>}
              {l.value === 0 && !props.notes?.[l.key] && <em>{st('notDone', lang)}</em>}
            </span>
            <b className="money">{l.sign === -1 && l.value > 0 ? '−' : ''}{formatMoney(l.value)}</b>
          </li>
        ))}
      </ul>

      <div className="shift-expected">
        <span>{st('expected', lang)}</span>
        <b className="money">{formatMoney(exp)}</b>
      </div>

      <div className="label-mono">{st('countPrompt', lang)}</div>
      <div className="label-mono">{st('countedLbl', lang)}</div>
      <div className="tendered money">{counted === null ? '—' : formatMoney(counted)}</div>
      <div className="numpad">
        {['1','2','3','4','5','6','7','8','9','C','0','del'].map((k) => (
          <button key={k} className="btn numpad-key"
            onClick={() => setCounted(tenderPress(countedTenge ?? 0, k))}>{k === 'del' ? '⌫' : k}</button>
        ))}
      </div>

      <div className={`change shift-diff ${diff === 0 ? '' : diff > 0 ? 'diff-pos' : 'diff-neg'}`}>
        <span>{diffCaption(diff, lang)}</span>
        <b className="money">{counted === null ? '—' : (diff > 0 ? '+' : '') + formatMoney(diff)}</b>
      </div>
      <p className="hint">{diffHint(counted, diff, lang)}</p>

      <div className="pay-actions">
        <button className="btn" onClick={() => setCounted(null)}>{st('recount', lang)}</button>
        <button className="btn btn-ok" disabled={counted === null}
          onClick={() => props.onClose(counted!, diff)}>
          {closeButtonLabel(counted, diff, lang)}
        </button>
      </div>
    </div>
  );
}

// ═══════════════ ТЕКСТЫ ЭКРАНОВ ВХОДА И СМЕН ═══════════════
// Планшет 1366×768, тёмная тема. Минимальная цель касания 44 px:
// кассир работает мокрыми руками и в спешке.

export const SHIFT_SCREENS_COPY = {
  device: 'Касса · планшет 1366×768 · тёмная тема',
  purpose: 'Вход, карта зала и смены',
  touchTarget: 'минимальная цель касания',

  // 01 — вход
  login: {
    title: '01 · Вход по PIN',
    // PIN выдаёт владелец, а не сам сотрудник: иначе кассир
    // поставит 1111 и передаст сменщику
    hint: 'PIN выдаёт владелец в бэк-офисе',
  },

  // 02 — карта зала
  hall: {
    title: '02 · Карта зала',
    takeaway: 'Навынос',
  },

  // 03 — открытие смены
  open: {
    title: '03 · Открытие смены',
    // Статус фискализации показываем ДО открытия: если ОФД молчит,
    // кассир должен знать это сейчас, а не после первого чека
    fiscalOk: 'Webkassa отвечает, смена будет фискальной',
    stopList: (items: string) => `Стоп-лист: ${items} — кухня отметила вчера`,
    button: (sum: string) => `Открыть смену · ${sum}`,
    prevShift: (date: string) => `Прошлая смена · ${date}`,
  },

  // 04 — закрытие
  close: {
    title: '04 · Закрытие смены · живой пересчёт',
    summary: (from: string, to: string, who: string, checks: number) =>
      `Смена ${from} — ${to} · ${who} · ${checks} чека`,
  },
} as const;

/** Склонение чеков для сводки смены. */
export function checksLabel(n: number): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return `${n} чек`;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return `${n} чека`;
  return `${n} чеков`;
}

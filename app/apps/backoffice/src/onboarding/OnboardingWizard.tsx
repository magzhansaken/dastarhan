// apps/backoffice/src/onboarding/OnboardingWizard.tsx
// МАСТЕР НАСТРОЙКИ — ТОЧНО по макету «Онбординг — Мастер настройки» Claude Design.
// Шесть шагов от типа заведения до первого чека. Все заголовки, пояснения
// и подписи вертикалей взяты из макета дословно.
import React, { useState } from 'react';

export type OnbLang = 'ru' | 'kk';

// ═══════════════ СЛОВАРЬ (из макета) ═══════════════

export const OT = {
  title:      { ru: 'Настройка', kk: 'Баптау' },
  step:       { ru: 'Шаг', kk: 'Қадам' },
  of:         { ru: 'из 6', kk: '6-дан' },
  next:       { ru: 'Дальше', kk: 'Әрі қарай' },
  back:       { ru: 'Назад', kk: 'Артқа' },
  skip:       { ru: 'Пропустить', kk: 'Өткізіп жіберу' },
  done:       { ru: 'Готово', kk: 'Дайын' },
  finish:     { ru: 'Завершить настройку', kk: 'Баптауды аяқтау' },
  allSet:     { ru: 'Всё настроено', kk: 'Бәрі бапталды' },
  firstCheck: { ru: 'Смена → размен → блюдо → оплата. Пять касаний, дальше можно звать гостей.',
                kk: 'Ауысым → ұсақ ақша → тағам → төлем. Бес басу, әрі қарай қонақ шақыруға болады.' },
  goPos:      { ru: 'Зайдите на планшете под PIN', kk: 'Планшетте PIN арқылы кіріңіз' },
  whyStep:    { ru: 'Зачем этот шаг', kk: 'Бұл қадам не үшін' },
  change:     { ru: 'Изменить', kk: 'Өзгерту' },
  trial:      { ru: '14 дней, до 9 августа. Карту не спросим.', kk: '14 күн, 9 тамызға дейін. Картаны сұрамаймыз.' },
  kaspiOk:    { ru: 'Kaspi подключён', kk: 'Kaspi қосылды' },
  kaspiHint:  { ru: 'Для доставки и Telegram-бота. Нужен номер, на который приходят выплаты.',
                kk: 'Жеткізу мен Telegram-бот үшін. Төлемдер түсетін нөмір қажет.' },
  kaspiNote:  { ru: 'оплата появится на кассе сразу', kk: 'төлем кассада бірден пайда болады' },
  openShift:  { ru: 'внесите размен — и можно пробивать первый чек',
                kk: 'ұсақ ақшаны енгізіңіз — алғашқы чекті өткізуге болады' },
  more:       { ru: 'Что можно подключить потом', kk: 'Кейін не қосуға болады' },
  selected:   { ru: 'Выбрано', kk: 'Таңдалды' },
} as const;

export const ot = (k: keyof typeof OT, lang: OnbLang = 'ru') => OT[k][lang];

/** Шесть шагов — названия и пояснения ТОЧНО из макета. */
export const ONB_STEPS = [
  { key: 'business', tab: 'Бизнес',        title: 'Какое у вас заведение?',
    hint: 'Настройки касс, склада и отчётов подстроятся под тип — потом можно поменять.', minutes: 1 },
  { key: 'location', tab: 'Точка',         title: 'Первая точка',
    hint: 'Название увидит гость в чеке и в QR-меню. Адрес пригодится курьерам и Wolt.', minutes: 2 },
  { key: 'fiscal',   tab: 'Касса',         title: 'Фискализация',
    hint: 'Без этого чек не будет фискальным. Занимает минуту, если у вас уже есть кабинет.', minutes: 3 },
  { key: 'menu',     tab: 'Меню',          title: 'Меню и техкарты',
    hint: 'Возьмите готовое меню и правьте под себя — быстрее, чем заводить с нуля.', minutes: 5 },
  { key: 'staff',    tab: 'Люди',          title: 'Сотрудники и PIN',
    hint: 'Кассир заходит на планшете по коду из четырёх цифр. Права можно настроить позже.', minutes: 1 },
  { key: 'kaspi',    tab: 'Оплата Kaspi',  title: 'Оплата Kaspi',
    hint: 'Чтобы гость мог платить QR-ом с первого дня. Наличные работают и без этого шага.', minutes: 2 },
] as const;

/** Типы заведений с описанием — из макета. */
export const BUSINESS_TYPES = [
  { key: 'CAFE',     title: 'Кафе и ресторан', note: 'Карта зала, курсы подачи, KDS' },
  { key: 'FASTFOOD', title: 'Фастфуд',         note: 'Быстрый чек, модификаторы, доставка' },
  { key: 'SHOP',     title: 'Магазин',         note: 'Штрихкоды, вес, приёмка' },
  { key: 'BILLIARD', title: 'Бильярд и клуб',  note: 'Тарификация столов по минутам' },
  { key: 'SALON',    title: 'Салон красоты',   note: 'Записи мастеров, услуги' },
  { key: 'OTHER',    title: 'Другое',          note: 'Соберём под вашу задачу' },
] as const;

/** Способы завести меню — из макета. */
export const MENU_SOURCES = [
  { key: 'template', title: 'Готовое меню кафе',
    note: '64 блюда казахской и европейской кухни с техкартами. Правится потом.' },
  { key: 'upload',   title: 'Загрузить свой прайс',
    note: 'Excel, CSV или экспорт из старой системы. Разберём и покажем результат.' },
  { key: 'manual',   title: 'Завести вручную',
    note: 'Если позиций немного — заведёте прямо здесь.' },
] as const;

// ═══════════════ ПРОГРЕСС ═══════════════

export function onbProgress(doneKeys: string[]) {
  const total = ONB_STEPS.length;
  const done = ONB_STEPS.filter((s) => doneKeys.includes(s.key)).length;
  const left = ONB_STEPS.filter((s) => !doneKeys.includes(s.key));
  return {
    done, total,
    pct: Math.round(100 * done / total),
    minutesLeft: left.reduce((s, x) => s + x.minutes, 0),
    nextStep: left[0] ?? null,
  };
}

// ═══════════════ ЭКРАН МАСТЕРА ═══════════════

export function OnboardingWizard(props: {
  accountName: string;
  ownerName: string;
  doneKeys: string[];
  activeKey: string;
  lang?: OnbLang;
  selected?: { business?: string; menuSource?: string };
  onSelectBusiness?: (key: string) => void;
  onSelectMenuSource?: (key: string) => void;
  onStep: (key: string) => void;
  onNext: () => void;
  onSkip?: () => void;
  onFinish: () => void;
}) {
  const lang = props.lang ?? 'ru';
  const p = onbProgress(props.doneKeys);
  const idx = ONB_STEPS.findIndex((s) => s.key === props.activeKey);
  const step = ONB_STEPS[idx] ?? ONB_STEPS[0];
  const allDone = p.done === p.total;

  return (
    <div className="onb-wizard">
      <header className="onb-head">
        <div>
          <span className="label-mono">{ot('title', lang)} · {props.accountName}</span>
          <h2>{allDone ? `${ot('allSet', lang)}, ${props.ownerName}` : step.title}</h2>
        </div>
        <span className="label-mono">{ot('step', lang)} {idx + 1} {ot('of', lang)}</span>
      </header>

      <div className="onb-tabs">
        {ONB_STEPS.map((s, i) => (
          <button key={s.key}
            className={`onb-tab ${s.key === props.activeKey ? 'on' : ''} ${props.doneKeys.includes(s.key) ? 'done' : ''}`}
            onClick={() => props.onStep(s.key)}>
            <span className="onb-tab-n">{props.doneKeys.includes(s.key) ? '✓' : i + 1}</span>
            {s.tab}
          </button>
        ))}
      </div>

      <div className="progress"><div style={{ width: `${p.pct}%` }} /></div>

      {!allDone && (
        <section className="onb-body">
          <p className="hint">{step.hint}</p>

          {step.key === 'business' && (
            <div className="onb-cards">
              {BUSINESS_TYPES.map((b) => (
                <button key={b.key}
                  className={`onb-card ${props.selected?.business === b.key ? 'on' : ''}`}
                  onClick={() => props.onSelectBusiness?.(b.key)}>
                  <b>{b.title}</b>
                  <em>{b.note}</em>
                  {props.selected?.business === b.key && <span className="onb-chosen">{ot('selected', lang)}</span>}
                </button>
              ))}
            </div>
          )}

          {step.key === 'menu' && (
            <div className="onb-cards">
              {MENU_SOURCES.map((m) => (
                <button key={m.key}
                  className={`onb-card ${props.selected?.menuSource === m.key ? 'on' : ''}`}
                  onClick={() => props.onSelectMenuSource?.(m.key)}>
                  <b>{m.title}</b>
                  <em>{m.note}</em>
                </button>
              ))}
            </div>
          )}

          {step.key === 'location' && (
            <div className="onb-fields">
              <label>Название заведения<input className="field-lg" placeholder="Дастархан" /></label>
              <label>Адрес<input className="field-lg" placeholder="проспект Абая, 52" /></label>
              <label>Город<input className="field-lg" placeholder="Алматы" /></label>
            </div>
          )}

          {step.key === 'fiscal' && (
            <div className="onb-fields">
              <label>Логин Webkassa<input className="field-lg" /></label>
              <label>Пароль<input className="field-lg" type="password" /></label>
              <label>Номер кассы<input className="field-lg" /></label>
            </div>
          )}

          {step.key === 'staff' && (
            <div className="onb-fields">
              <label>Имя сотрудника<input className="field-lg" placeholder="Айгерим" /></label>
              <label>PIN для кассы<input className="field-lg" placeholder="4 цифры" inputMode="numeric" /></label>
              <label>Роль<select className="field-lg"><option>Кассир</option><option>Официант</option><option>Менеджер</option></select></label>
            </div>
          )}

          {step.key === 'kaspi' && (
            <div className="onb-fields">
              <label>Номер Kaspi<input className="field-lg" placeholder="+7 707 000 00 00" /></label>
              <p className="hint">{ot('kaspiHint', lang)}</p>
              <p className="hint">{ot('kaspiOk', lang)} · {ot('kaspiNote', lang)}.</p>
            </div>
          )}

          <div className="onb-actions">
            {props.onSkip && <button className="btn" onClick={props.onSkip}>{ot('skip', lang)}</button>}
            <button className="btn btn-accent" onClick={props.onNext}>{ot('next', lang)}</button>
          </div>
        </section>
      )}

      {allDone && (
        <section className="onb-finish">
          <p>{ot('firstCheck', lang)}</p>
          <p className="hint">{ot('goPos', lang)}, {ot('openShift', lang)}.</p>
          <p className="hint">{ot('trial', lang)}</p>
          <button className="btn btn-ok" onClick={props.onFinish}>{ot('finish', lang)}</button>
        </section>
      )}

      {allDone && (
        <section className="onb-later">
          <div className="label-mono">{ot('more', lang)}</div>
          <ul className="works-list">
            <li><span className="w-mark">·</span> QR-меню на столы</li>
            <li><span className="w-mark">·</span> Telegram-бот</li>
            <li><span className="w-mark">·</span> 1С Бухгалтерия</li>
          </ul>
        </section>
      )}

      {!allDone && (
        <footer className="onb-foot label-mono">
          {p.minutesLeft} мин до первого чека
        </footer>
      )}
    </div>
  );
}

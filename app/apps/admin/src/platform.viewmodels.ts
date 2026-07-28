// apps/admin/src/platform.viewmodels.ts
// ПАНЕЛЬ ВЕНДОРА — контроль всего продукта. Анализ 5 конкурентов:
//  · r_keeper: единый кабинет my.rkeeper.ru — покупка лицензий мастером
//    (заведение → продукты → лимиты → предложение → оплата); SOS-код =
//    временная лицензия ≤5 дней С ОБЯЗАТЕЛЬНОЙ ПРИЧИНОЙ-ОБОСНОВАНИЕМ
//  · Paloma (модель КЗ): счёт в конце месяца, оплатить до 15 числа;
//    БАЛАНС аккаунта + пополнение через Kaspi Платежи по номеру аккаунта;
//    аванс со скидкой — но ЧЕРЕЗ ПЕРЕПИСКУ ПО ПОЧТЕ (слабость — автоматизируем)
//  · Poster: «Настройки → Оплата подписки → Счета» в самой админке
//  · QuickResto/iiko: кабинет + дилерский контур
// Наши профи-добавки сверх рынка:
//  1) HEALTH-SCORE КЛИЕНТА — риск оттока по поведению (нет чеков, не
//     закрывают смены, пустое меню). Ни у кого из 5 нет — узнаём об уходе
//     клиента ЗА НЕДЕЛЮ, а не по факту неоплаты
//  2) ПРЕДОПЛАТА вместо постоплаты Paloma (у них кассовый разрыв + долги)
//  3) SOS-код: причина обязательна (r_keeper) + лимит на аккаунт + автоистечение
//  4) Impersonation («войти как клиент») с обязательной записью в аудит

export type Money = number; // тиыны

// ═══════════════ ДАШБОРД ПЛАТФОРМЫ ═══════════════

export interface AccountRow {
  accountId: string; name: string; city: string;
  vertical: 'CAFE' | 'FASTFOOD' | 'SHOP' | 'SALON' | 'BILLIARD';
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
  locations: number;
  mrr: Money;               // сумма подписки в месяц
  periodEnd: Date;
  dealerId?: string;
  // поведение (для health-score)
  lastCheckAt?: Date;       // последний пробитый чек
  checksLast7d: number;
  shiftsClosedLast7d: number;
  menuItems: number;
  balance: Money;           // баланс аккаунта (модель Paloma)
}

export function platformDashboard(rows: AccountRow[], now: Date) {
  const paying = rows.filter((r) => r.status === 'ACTIVE' || r.status === 'PAST_DUE');
  const mrr = paying.reduce((s, r) => s + r.mrr, 0);
  const trials = rows.filter((r) => r.status === 'TRIAL');
  const pastDue = rows.filter((r) => r.status === 'PAST_DUE');
  const expiringSoon = rows.filter((r) =>
    r.status === 'ACTIVE'
    && (r.periodEnd.getTime() - now.getTime()) / 86400000 <= 7
    && r.periodEnd >= now);
  return {
    mrr,
    payingAccounts: paying.length,
    locations: paying.reduce((s, r) => s + r.locations, 0),
    trials: trials.length,
    pastDue: pastDue.length,
    pastDueMoney: pastDue.reduce((s, r) => s + r.mrr, 0),
    expiringSoon: expiringSoon.length,
    arpu: paying.length ? Math.round(mrr / paying.length) : 0,
  };
}

// ═══════════════ HEALTH-SCORE (наша добавка) ═══════════════

export type HealthLevel = 'healthy' | 'watch' | 'at_risk' | 'dying';

export interface Health { score: number; level: HealthLevel; reasons: string[] }

/** Оценка здоровья клиента по ПОВЕДЕНИЮ, а не по оплате.
 *  Оплата — следствие; поведение — причина. Ловим отток заранее. */
export function healthScore(r: AccountRow, now: Date): Health {
  let score = 100;
  const reasons: string[] = [];

  const daysSinceCheck = r.lastCheckAt
    ? Math.floor((now.getTime() - r.lastCheckAt.getTime()) / 86400000)
    : 999;

  if (daysSinceCheck >= 7) { score -= 50; reasons.push(`Нет продаж ${daysSinceCheck} дн.`); }
  else if (daysSinceCheck >= 3) { score -= 25; reasons.push(`Нет продаж ${daysSinceCheck} дн.`); }

  if (r.checksLast7d === 0 && daysSinceCheck < 7) { score -= 10; reasons.push('Ноль чеков за неделю'); }
  else if (r.checksLast7d < 20 && r.status !== 'TRIAL') { score -= 15; reasons.push(`Мало чеков: ${r.checksLast7d}/нед`); }

  if (r.shiftsClosedLast7d === 0) { score -= 15; reasons.push('Смены не закрываются'); }
  // У ПРОБНОГО риск другой, чем у платящего: не отток, а НЕ-АКТИВАЦИЯ.
  // Он не уйдёт — он просто никогда не начнёт. Это метрика №1 в SaaS.
  if (r.status === 'TRIAL' && r.checksLast7d < 10) {
    score -= 20; reasons.push('Пробный не начал продавать — довести до первого чека');
  }
  // Пустое меню — признак НЕЗАВЕРШЁННОЙ НАСТРОЙКИ, а не болезни: киоск с
  // двумя позициями и 250 чеками в неделю здоров. Штрафуем только тех, кто
  // ещё не разошёлся (пробный период или мало продаж). Поймано тестом.
  if (r.menuItems < 5 && (r.status === 'TRIAL' || r.checksLast7d < 50)) {
    score -= 20; reasons.push(`Меню почти пустое: ${r.menuItems} позиций — настройка не закончена`);
  }
  if (r.status === 'PAST_DUE') { score -= 20; reasons.push('Просрочка оплаты'); }

  score = Math.max(0, Math.min(100, score));
  const level: HealthLevel =
    score >= 75 ? 'healthy' : score >= 50 ? 'watch' : score >= 25 ? 'at_risk' : 'dying';
  return { score, level, reasons };
}

/** Кого спасать в первую очередь: сначала дорогие и умирающие. */
export function rescueQueue(rows: AccountRow[], now: Date, limit = 10) {
  return rows
    .filter((r) => r.status !== 'CANCELLED')
    .map((r) => ({ row: r, health: healthScore(r, now) }))
    .filter((x) => x.health.level === 'at_risk' || x.health.level === 'dying')
    .sort((a, b) => (b.row.mrr - a.row.mrr) || (a.health.score - b.health.score))
    .slice(0, limit);
}

// ═══════════════ СЧЕТА И ОПЛАТА (модель КЗ) ═══════════════

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'VOID';

export interface Invoice {
  id: string; number: string; accountId: string;
  periodFrom: Date; periodTo: Date;
  amount: Money;
  issuedAt: Date; dueAt: Date;
  status: InvoiceStatus;
  paidAt?: Date;
}

/** Мы работаем ПО ПРЕДОПЛАТЕ (исправление слабости Paloma: у них счёт в
 *  конце месяца и оплата до 15-го — кассовый разрыв и долги).
 *  Счёт выставляется за 7 дней ДО начала периода, срок оплаты — старт периода. */
export function nextInvoice(
  acc: { accountId: string; mrr: Money; periodEnd: Date },
  seq: number, now: Date,
): Invoice | null {
  const daysToEnd = (acc.periodEnd.getTime() - now.getTime()) / 86400000;
  if (daysToEnd > 7 || daysToEnd < 0) return null;
  const from = acc.periodEnd;
  const to = new Date(from.getFullYear(), from.getMonth() + 1, from.getDate());
  return {
    id: `inv_${acc.accountId}_${seq}`,
    number: `DSTR-${String(seq).padStart(5, '0')}`,
    accountId: acc.accountId,
    periodFrom: from, periodTo: to,
    amount: acc.mrr,
    issuedAt: now, dueAt: from,
    status: 'ISSUED',
  };
}

export function invoiceStatusAt(inv: Invoice, now: Date): InvoiceStatus {
  if (inv.status === 'PAID' || inv.status === 'VOID' || inv.status === 'DRAFT') return inv.status;
  return now > inv.dueAt ? 'OVERDUE' : 'ISSUED';
}

/** Оплата с баланса аккаунта (Paloma-модель, автоматизированная):
 *  клиент пополняет баланс через Kaspi Платежи по номеру аккаунта →
 *  система сама гасит ближайший счёт и продлевает подписку. */
export function payFromBalance(balance: Money, inv: Invoice): { ok: boolean; newBalance: Money; short?: Money } {
  if (balance >= inv.amount) return { ok: true, newBalance: balance - inv.amount };
  return { ok: false, newBalance: balance, short: inv.amount - balance };
}

/** Годовая предоплата со скидкой — кнопкой, а не перепиской по почте. */
export function annualOffer(monthly: Money, discountPct = 17): { total: Money; saved: Money; months: number } {
  const full = monthly * 12;
  const total = Math.round(full * (100 - discountPct) / 100);
  return { total, saved: full - total, months: 12 };
}

// ═══════════════ DUNNING (напоминания об оплате) ═══════════════

export interface DunningStep { day: number; channel: 'email' | 'sms' | 'telegram'; text: string }

/** Расписание напоминаний относительно даты окончания периода.
 *  Отрицательные дни — до, положительные — после. */
export function dunningPlan(amount: Money): DunningStep[] {
  const sum = `${Math.trunc(amount / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
  return [
    { day: -7, channel: 'email', text: `Через 7 дней продление подписки — ${sum}. Счёт уже в кабинете.` },
    { day: -1, channel: 'telegram', text: `Завтра продление подписки — ${sum}. Пополните баланс через Kaspi.` },
    { day: 0, channel: 'sms', text: `Оплата не поступила. Касса работает 7 дней, бэк-офис — только чтение.` },
    { day: 3, channel: 'telegram', text: `Осталось 4 дня льготного периода. Оплатите ${sum}, чтобы не остановить продажи.` },
    { day: 6, channel: 'sms', text: `Завтра продажи будут приостановлены. Нужна помощь — напишите нам.` },
  ];
}

export function dueDunningSteps(periodEnd: Date, now: Date, amount: Money): DunningStep[] {
  const dayDiff = Math.floor((now.getTime() - periodEnd.getTime()) / 86400000);
  return dunningPlan(amount).filter((s) => s.day === dayDiff);
}

// ═══════════════ SOS-КОД (r_keeper-механика, доведённая) ═══════════════

export const SOS_REASONS = [
  'Замена оборудования / поломка',
  'Экстренная установка на точке',
  'Срочное обновление ПО',
  'Оплата в пути (банк/выходной)',
] as const;

export interface SosCode {
  code: string; accountId: string;
  reason: string; issuedBy: string;
  issuedAt: Date; expiresAt: Date;
  usedAt?: Date;
}

export class SosError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

/** Выдача SOS: причина ОБЯЗАТЕЛЬНА (правило r_keeper), срок ≤5 дней,
 *  не более 2 кодов на аккаунт в квартал (наша защита от злоупотребления). */
export function issueSos(
  accountId: string, reason: string, issuedBy: string, now: Date,
  history: SosCode[], days = 5,
): SosCode {
  if (!reason || !reason.trim()) throw new SosError('REASON_REQUIRED', 'Укажите причину-обоснование');
  if (days < 1 || days > 5) throw new SosError('BAD_TERM', 'Срок SOS — от 1 до 5 дней');
  const quarterAgo = new Date(now.getTime() - 90 * 86400000);
  const recent = history.filter((s) => s.accountId === accountId && s.issuedAt >= quarterAgo);
  if (recent.length >= 2) throw new SosError('LIMIT', 'Уже 2 SOS-кода за квартал — нужна оплата');
  return {
    code: `SOS-${accountId.slice(0, 4).toUpperCase()}-${String(now.getTime()).slice(-5)}`,
    accountId, reason: reason.trim(), issuedBy,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + days * 86400000),
  };
}

export function sosActive(s: SosCode, now: Date): boolean {
  return now >= s.issuedAt && now < s.expiresAt;
}

// ═══════════════ IMPERSONATION («войти как клиент») ═══════════════

export interface ImpersonationTicket {
  accountId: string; staffUser: string; reason: string;
  startedAt: Date; expiresAt: Date; readOnly: boolean;
}

/** Вход в аккаунт клиента для поддержки: причина обязательна, срок 60 мин,
 *  по умолчанию ТОЛЬКО ЧТЕНИЕ. Всё пишется в аудит — иначе доверие теряется. */
export function startImpersonation(
  accountId: string, staffUser: string, reason: string, now: Date, writeAccess = false,
): ImpersonationTicket {
  if (!reason || reason.trim().length < 5)
    throw new SosError('REASON_REQUIRED', 'Опишите причину входа (минимум 5 символов)');
  return {
    accountId, staffUser, reason: reason.trim(),
    startedAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60000),
    readOnly: !writeAccess,
  };
}

// ═══════════════ ДИЛЕРЫ ═══════════════

export interface DealerRow {
  dealerId: string; name: string; region: string; commissionPct: number;
  accounts: string[];      // accountId его клиентов
}

/** Начисление дилеру за месяц: % от MRR его ЖИВЫХ клиентов (recurring). */
export function dealerPayout(d: DealerRow, accounts: AccountRow[]): { base: Money; commission: Money; alive: number } {
  const mine = accounts.filter((a) => d.accounts.includes(a.accountId) && a.status === 'ACTIVE');
  const base = mine.reduce((s, a) => s + a.mrr, 0);
  return { base, commission: Math.round(base * d.commissionPct / 100), alive: mine.length };
}


// ═══════════════════════════════════════════════════════════════════
// ДОПОЛНЕНО ПО МАКЕТУ «Супер-админка вендора» (Claude Design, волна 2)
// ═══════════════════════════════════════════════════════════════════

/** Разделы бокового меню админки — из макета. */
export const VENDOR_NAV = [
  { id: 'pulse',    title: 'Пульс' },
  { id: 'accounts', title: 'Аккаунты' },
  { id: 'health',   title: 'Здоровье клиентов' },
  { id: 'billing',  title: 'Биллинг' },
  { id: 'tickets',  title: 'Тикеты' },
  { id: 'dealers',  title: 'Дилеры' },
  { id: 'plans',    title: 'Тарифы и функции' },
] as const;

/** Матрица «тариф × функция» — состав и пояснения из макета. */
export const FEATURE_MATRIX = [
  { key: 'pos',      title: 'Касса, смены, фискальный чек', note: '',                          plans: ['START','BUSINESS','NETWORK'] },
  { key: 'stock',    title: 'Склад и техкарты',             note: 'себестоимость и фудкост',    plans: ['START','BUSINESS','NETWORK'] },
  { key: 'offline',  title: 'Работа без интернета',         note: 'офлайн-очередь чеков',       plans: ['START','BUSINESS','NETWORK'] },
  { key: 'fiscal',   title: 'Webkassa и re:Kassa',          note: '',                           plans: ['START','BUSINESS','NETWORK'] },
  { key: 'reports',  title: 'Отчёты владельца',             note: 'прибыль с налогом 3%',       plans: ['BUSINESS','NETWORK'] },
  { key: 'delivery', title: 'Доставка и курьеры',           note: 'рейсы, долг наличных',       plans: ['BUSINESS','NETWORK'] },
  { key: 'loyalty',  title: 'Лояльность и бонусы',          note: 'по номеру телефона',         plans: ['BUSINESS','NETWORK'] },
  { key: 'ai',       title: 'ИИ-помощник',                  note: 'вопросы словами',            plans: ['BUSINESS','NETWORK'] },
  { key: 'booking',  title: 'Брони и шахматка',             note: 'зал и бильярд',              plans: ['BUSINESS','NETWORK'] },
  { key: 'central',  title: 'Центральный склад',            note: 'перемещения между точками',  plans: ['NETWORK'] },
  { key: 'franchise',title: 'Франшиза и роялти',            note: 'отчёты по партнёрам',        plans: ['NETWORK'] },
] as const;

export function planHasFeature(planKey: string, featureKey: string): boolean {
  const f = FEATURE_MATRIX.find((x) => x.key === featureKey);
  return !!f && (f.plans as readonly string[]).includes(planKey);
}

/** Сколько функций в тарифе — подпись под колонкой матрицы. */
export function planFeatureCount(planKey: string): number {
  return FEATURE_MATRIX.filter((f) => (f.plans as readonly string[]).includes(planKey)).length;
}

// ── ТИКЕТЫ ──
export type TicketPriority = 'critical' | 'normal';
export type TicketChannel = 'call' | 'mail' | 'chat';

export const TICKET_CHANNEL = {
  call: { ru: 'звонок', kk: 'қоңырау' },
  mail: { ru: 'почта', kk: 'пошта' },
  chat: { ru: 'чат в кассе', kk: 'кассадағы чат' },
} as const;

export const TICKET_PRIORITY = {
  critical: { ru: 'критично', sla: 15 },   // SLA 15 мин — из макета
  normal:   { ru: 'обычный',  sla: 120 },  // SLA 2 часа
} as const;

/** Обратный отсчёт SLA — из макета: «осталось 9 мин» / «просрочен 6 мин». */
export function slaCountdown(openedAt: Date, priority: TicketPriority, now: Date):
  { text: string; state: 'ok' | 'soon' | 'late'; minutesLeft: number } {
  const limit = TICKET_PRIORITY[priority].sla;
  const passed = Math.floor((now.getTime() - openedAt.getTime()) / 60000);
  const left = limit - passed;
  if (left < 0) return { text: `просрочен ${-left} мин`, state: 'late', minutesLeft: left };
  const h = Math.floor(left / 60), m = left % 60;
  const text = h > 0 ? `осталось ${h} ч ${m} мин` : `осталось ${left} мин`;
  // порог тревоги: не меньше 10 минут и не меньше четверти SLA —
  // для критичного (15 мин) это 10 мин, для обычного (2 ч) — 30 мин
  const warnAt = Math.max(10, Math.round(limit * 0.25));
  return { text, state: left <= warnAt ? 'soon' : 'ok', minutesLeft: left };
}

/** Типовые темы обращений — из макета (для автоподсказок оператору). */
export const TICKET_TOPICS = [
  'Чеки не уходят в ОФД', 'Kaspi QR не открывается', 'Не печатается пречек',
  'Курьер не видит рейс', 'Смена не закрыта', 'Нужен доступ второму менеджеру',
  'Как закрыть смену за кассира', 'Как завести весовой товар',
  'Перенос меню из Poster', 'Импорт из 1С', 'Перевод на ИП', 'Работа без интернета',
] as const;

// ── ЖУРНАЛ ДЕЙСТВИЙ КЛИЕНТА (карточка) ──
export type ClientEventKind = 'location' | 'techcard' | 'supply' | 'shift_open' | 'shift_close' | 'payment';

/** Строка журнала — формулировки из макета. */
export function clientEventLabel(e: {
  kind: ClientEventKind; name?: string; amount?: number; extra?: string;
}): string {
  const money = (t?: number) => t != null ? `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g,' ')} ₸` : '';
  switch (e.kind) {
    case 'location':    return `Добавлена точка ${e.name}${e.extra ? ` · ${e.extra}` : ''}`;
    case 'techcard':    return `Изменена техкарта «${e.name}»${e.extra ? ` · ${e.extra}` : ''}`;
    case 'supply':      return `Принята поставка ${e.name} · ${money(e.amount)}`;
    case 'shift_open':  return `Смена открыта · размен ${money(e.amount)}`;
    case 'shift_close': return `Смена закрыта · ${e.name} · расхождение ${money(e.amount)}`;
    case 'payment':     return `Платёж ${money(e.amount)} · ${e.name ?? 'Kaspi'}`;
  }
}


/** Действия админки — подписи ТОЧНО из макета «Супер-админка вендора». */
export const ADMIN_ACTIONS = {
  take:        'Взять',
  takeNext:    'Взять следующий',
  assign:      'Назначить',
  notAssigned: 'не назначен',
  setSla:      'Настроить SLA',
  issueInvoice:'Выставить счёт',
  receipt:     'Квитанция',
  exportAcc:   'Выгрузить для бухгалтерии',
  exportReport:'Выгрузить отчёт',
  callOwner:   'Позвонить владельцу',
  whatsapp:    'Написать в WhatsApp',
  remind:      'Напомнить',
  broadcast:   'Отправить рассылку',
  open:        'Открыть',
  createAcc:   'Создать аккаунт',
  saveMatrix:  'Сохранить матрицу',
  clientCard:  'Карточка клиента',
  history:     'История изменений',
} as const;

/** Статусы аккаунта словами — из макета. */
export const ACCOUNT_STATUS_RU = {
  TRIAL: 'Пробный', ACTIVE: 'Платит', PAST_DUE: 'Просрочка',
  SUSPENDED: 'Заморожен', CANCELLED: 'Отменён',
} as const;

/** Статус терминала — из макета «В сети» / «Касса не в сети». */
export function terminalStatusLabel(lastSeenAt: Date | null, now: Date): { text: string; ok: boolean } {
  if (!lastSeenAt) return { text: 'Касса не в сети', ok: false };
  const h = (now.getTime() - lastSeenAt.getTime()) / 3600000;
  return h < 1 ? { text: 'В сети', ok: true } : { text: 'Касса не в сети', ok: false };
}

/** Подпись способа оплаты счёта — из макета. */
export function payMethodNote(auto: boolean, deferDays = 0): string {
  if (deferDays > 0) return `Kaspi · с отсрочкой ${deferDays} дня`;
  return auto ? 'Kaspi · автоплатёж включён' : 'Kaspi · автоплатёж выключен';
}

// ═══════════════ ПУЛЬС: МЕТРИКИ БИЗНЕСА ВЕНДОРА ═══════════════
// Владелец платформы смотрит сюда утром. Здесь не «данные»,
// а ответ на вопрос «растём или падаем и что с этим делать».

export const PULSE_METRICS = {
  mrr: {
    title: 'MRR сегодня',
    growth: (pct: string) => `+${pct}% за месяц`,
    // Сравнение в деньгах, а не только в процентах: «+6,1%» ни о чём
    // не говорит, «+254 000 ₸» — говорит
    delta: (month: string, sum: string) => `к ${month} · ${sum}`,
  },
  newClients: {
    title: 'Новых за июль',
    prev: (pct: string, month: string) => `было ${pct}% в ${month}`,
  },
  chart: {
    title: 'MRR по месяцам',
    note: 'оранжевый — июль',
  },
  activation: {
    // Главная метрика SaaS: зарегистрировался ≠ начал пользоваться.
    // Считаем тех, кто дошёл до первого чека
    note: 'кто дошёл до первого чека',
  },
  arpu: {
    note: 'растёт от числа точек',
  },
  ltv: {
    title: 'Срок жизни клиента',
    note: 'считаем с первого платежа',
  },
  byPlan: {
    title: 'MRR по тарифам',
  },
} as const;

/** Сводка риска оттока для баннера на пульсе. */
export function churnRiskSummary(offline: number, noReceipts: number, revenueDown: number): string {
  const total = offline + noReceipts + revenueDown;
  return `${total} клиентов с сигналами ухода: ${offline} не в сети, ` +
    `${noReceipts} без чеков, ${revenueDown} с просевшей выручкой.`;
}

export const CHURN_LINK = 'Открыть «Здоровье клиентов» →';

// ═══════════════ КАРТОЧКА КЛИЕНТА ═══════════════

export const CLIENT_CARD = {
  search: 'Поиск по названию или БИН',
  colIncome: 'Доход / мес',
  colActivity: 'Активность',
  planLine: (plan: string, price: string) => `${plan} · ${price} / точка`,
  incomeMonth: 'Доход в месяц',
  paidTotal: 'Всего заплатил',
  // Сводка одной строкой: менеджеру не нужно открывать три вкладки,
  // чтобы понять, живой клиент или нет
  staffSummary: (users: number, roles: number, lastShift: string) =>
    `${users} сотрудников · ${roles} роли · последняя смена закрыта ${lastShift}`,
  actionsLog: 'Лог действий',
} as const;

/** Действия менеджера над клиентом. Порядок от мягкого к жёсткому. */
export const CLIENT_ACTIONS = [
  { id: 'extend', label: 'Продлить месяц' },
  { id: 'change_plan', label: 'Сменить тариф' },
  { id: 'grace', label: 'Дать отсрочку' },
  { id: 'freeze', label: 'Заморозить' },
] as const;

// ═══════════════ БИЛЛИНГ ВЕНДОРА ═══════════════

export const VENDOR_BILLING = {
  issued: 'Выставлено за август',
  avgPayDays: 'Средний срок оплаты',
  avgPayNote: 'от выставления счёта',
  invoices: 'Счета и оплаты',
  // Напоминания автоматические: менеджер не должен помнить,
  // кому и когда написать
  reminders: 'напоминания уходят сами: за 3 дня, в день оплаты, на 3-й день просрочки',
} as const;

// ═══════════════ ПОДДЕРЖКА ═══════════════

export const SUPPORT_QUEUE = {
  title: 'Очередь поддержки',
  sla: 'SLA: критичные 15 мин · обычные 2 часа',
  owner: 'Кто ведёт',
} as const;

// ═══════════════ ТАРИФЫ И ФУНКЦИИ ═══════════════

export const PLAN_MATRIX = {
  title: 'Что входит в тариф',
  // Предупреждение обязательно: одно нажатие меняет продукт
  // у всех клиентов тарифа сразу
  warning: 'переключатель включает функцию всем клиентам тарифа',
} as const;

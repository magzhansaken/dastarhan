// apps/api/src/staff/tips.logic.ts
// ЧАЕВЫЕ — новый модуль (пришёл из дизайн-ревизии).
// Анализ: QuickResto — «ссылка для приёма чаевых по QR-коду» у сотрудника;
// Poster — статья «как правильно принимать и учитывать чаевые: определите
// подходящий вариант». Ни у кого нет разбора НАЛОГОВОГО эффекта, а для
// Казахстана это ключевое: при упрощёнке 3% платится с ОБОРОТА, поэтому
// чаевые, прошедшие через кассу, увеличивают налог заведения.
//
// Наше решение: три способа приёма с явным налоговым следствием и
// правилом «чаевые не входят в выручку заведения».

export type Money = number; // тиыны

export type TipMethod =
  | 'qr_direct'   // QR на чеке → напрямую на Kaspi сотрудника (наш основной)
  | 'cash'        // наличными в руки — система только фиксирует факт
  | 'via_check';  // добавлено к чеку картой — проходит через счёт заведения

export interface TipRecord {
  id: string;
  employeeId: string;
  method: TipMethod;
  amount: Money;
  at: Date;
  orderId?: string;   // если чаевые привязаны к чеку
  locationId: string;
}

// ═══════════════ ЛИЧНАЯ ССЫЛКА СОТРУДНИКА ═══════════════

/** Транслитерация для slug. Казахские буквы обрабатываются отдельно —
 *  «Әйгерім» должно стать «aigerim», а не «?igerim». */
const TRANSLIT: Record<string, string> = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i',
  й:'i', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t',
  у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'',
  э:'e', ю:'yu', я:'ya',
  // казахские
  ә:'a', ғ:'g', қ:'k', ң:'n', ө:'o', ұ:'u', ү:'u', һ:'h', і:'i',
};

export function tipSlug(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  let out = '';
  for (const ch of first.toLowerCase()) {
    if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
  }
  return out || 'staff';
}

/** Уникальный slug: при совпадении добавляем номер (в заведении две Айгерим). */
export function uniqueTipSlug(fullName: string, taken: string[]): string {
  const base = tipSlug(fullName);
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function tipLink(slug: string, domain = 'dstrh.kz'): string {
  return `https://${domain}/tip/${slug}`;
}

// ═══════════════ УЧЁТ И НАЛОГОВЫЙ ЭФФЕКТ ═══════════════

/** Проходят ли чаевые через счёт заведения (и попадают ли в налоговую базу). */
export function goesThroughBusiness(method: TipMethod): boolean {
  return method === 'via_check';
}

/** Предупреждение владельцу при выборе способа. Считаем цену вопроса:
 *  при упрощёнке 3% каждые 100 000 ₸ чаевых через кассу = 3 000 ₸ налога. */
export function tipMethodNote(method: TipMethod, monthlyTips: Money, taxRatePct = 3): {
  tone: 'ok' | 'warn';
  text: string;
  extraTax: Money;
} {
  if (!goesThroughBusiness(method)) {
    return {
      tone: 'ok',
      extraTax: 0,
      text: method === 'qr_direct'
        ? 'Деньги идут напрямую сотруднику. В выручку заведения не попадают, налогом не облагаются.'
        : 'Наличные чаевые остаются у сотрудника. Система фиксирует их только для статистики.',
    };
  }
  const extraTax = Math.round((monthlyTips * taxRatePct) / 100);
  return {
    tone: 'warn',
    extraTax,
    text: `Чаевые через кассу попадают в оборот заведения. При ставке ${taxRatePct}% это ${fmtT(extraTax)} налога в месяц. Переведите сотрудников на QR-ссылки.`,
  };
}

const fmtT = (t: Money) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

/** Сводка по сотруднику за период. */
export function tipsSummary(tips: TipRecord[], employeeId: string, from: Date, to: Date) {
  const mine = tips.filter((t) => t.employeeId === employeeId && t.at >= from && t.at < to);
  const by = (m: TipMethod) => mine.filter((t) => t.method === m).reduce((s, t) => s + t.amount, 0);
  const total = mine.reduce((s, t) => s + t.amount, 0);
  return {
    total,
    count: mine.length,
    byQr: by('qr_direct'),
    byCash: by('cash'),
    viaCheck: by('via_check'),
    avgTip: mine.length ? Math.round(total / mine.length) : 0,
  };
}

/** ГЛАВНОЕ ПРАВИЛО: выручка заведения без чаевых.
 *  Чаевые через кассу физически пришли на счёт, но это НЕ доход заведения —
 *  вычитаем их из выручки и из налоговой базы, иначе владелец платит
 *  налог с денег официанта. */
export function revenueWithoutTips(grossRevenue: Money, tips: TipRecord[]): {
  revenue: Money; tipsThroughBusiness: Money;
} {
  const through = tips
    .filter((t) => goesThroughBusiness(t.method))
    .reduce((s, t) => s + t.amount, 0);
  return { revenue: grossRevenue - through, tipsThroughBusiness: through };
}

// ═══════════════ РАСПРЕДЕЛЕНИЕ НА КОМАНДУ (tip pooling) ═══════════════
// В части заведений чаевые делят на смену. Поддерживаем два правила.

export type PoolRule = 'equal' | 'by_hours';

export interface PoolMember { employeeId: string; name: string; hours: number }

/** Дележ общей суммы. Остаток от деления отдаём первому по списку —
 *  тиыны не должны исчезать (проверяется тестом). */
export function splitTipPool(
  amount: Money, members: PoolMember[], rule: PoolRule,
): { employeeId: string; name: string; amount: Money }[] {
  if (!members.length || amount <= 0) return [];
  let shares: number[];
  if (rule === 'equal') {
    shares = members.map(() => 1 / members.length);
  } else {
    const totalHours = members.reduce((s, m) => s + m.hours, 0);
    if (totalHours <= 0) return splitTipPool(amount, members, 'equal');
    shares = members.map((m) => m.hours / totalHours);
  }
  const out = members.map((m, i) => ({
    employeeId: m.employeeId, name: m.name,
    amount: Math.floor(amount * shares[i]),
  }));
  const distributed = out.reduce((s, o) => s + o.amount, 0);
  out[0].amount += amount - distributed; // остаток тиынов — первому
  return out;
}

// ═══════════════ QR НА ЧЕКЕ ═══════════════

/** Данные для печати QR чаевых на чеке (используется драйвером ESC/POS). */
export function tipQrPayload(slug: string, orderId: string, domain = 'dstrh.kz'): string {
  return `${tipLink(slug, domain)}?o=${orderId}`;
}

/** Подпись под QR на чеке — двуязычная. */
export const TIP_RECEIPT_LABEL = {
  ru: 'Понравилось обслуживание? Оставьте чаевые',
  kk: 'Кызмет унады ма? Шайпул калдырыныз',
};

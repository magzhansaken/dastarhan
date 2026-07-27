// apps/website/js/calc.js — ЛОГИКА КАЛЬКУЛЯТОРА ЦЕНЫ
// Вынесена отдельным модулем, чтобы покрыть тестами: цена на сайте должна
// совпадать с той, что потом выставит биллинг (subscriptionPrice в платформе).
// Модель ценообразования — Poster: платим за ТОЧКУ, первая касса включена,
// каждая следующая касса на точке — доплата. Годовая оплата даёт скидку.

export const PLANS = {
  START:    { key: 'START',    name: 'Старт',  nameKk: 'Бастау',  perLocation: 12000_00, summary: 'Касса, склад, отчёты' },
  BUSINESS: { key: 'BUSINESS', name: 'Бизнес', nameKk: 'Бизнес',  perLocation: 18000_00, summary: '+ доставка, лояльность, ИИ-помощник' },
  NETWORK:  { key: 'NETWORK',  name: 'Сеть',   nameKk: 'Желі',    perLocation: 26000_00, summary: '+ центральный склад, франшиза' },
};

export const EXTRA_TERMINAL_PRICE = 4000_00;  // за каждую кассу сверх первой
export const INCLUDED_TERMINALS = 1;          // касс включено в цену точки
export const YEARLY_DISCOUNT_PCT = 20;

/**
 * Расчёт стоимости подписки.
 * @param {'START'|'BUSINESS'|'NETWORK'} planKey
 * @param {number} locations  число точек (>=1)
 * @param {number} terminalsPerLocation  касс на каждой точке (>=1)
 * @param {boolean} yearly  годовая оплата
 * @returns {{monthly:number, extraTerminals:number, planLine:number,
 *            terminalsLine:number, discount:number, payNow:number, perMonthEffective:number}}
 */
export function calcPrice(planKey, locations, terminalsPerLocation, yearly) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error('UNKNOWN_PLAN');
  const loc = Math.max(1, Math.trunc(locations));
  const tills = Math.max(1, Math.trunc(terminalsPerLocation));

  const planLine = plan.perLocation * loc;
  const extraTerminals = Math.max(0, tills - INCLUDED_TERMINALS) * loc;
  const terminalsLine = extraTerminals * EXTRA_TERMINAL_PRICE;
  const monthly = planLine + terminalsLine;

  if (!yearly) {
    return { monthly, extraTerminals, planLine, terminalsLine,
             discount: 0, payNow: monthly, perMonthEffective: monthly };
  }
  const yearFull = monthly * 12;
  const discount = Math.round(yearFull * YEARLY_DISCOUNT_PCT / 100);
  const payNow = yearFull - discount;
  return { monthly, extraTerminals, planLine, terminalsLine,
           discount, payNow, perMonthEffective: Math.round(payNow / 12) };
}

/** Формат денег для сайта: 12 000 ₸ (без копеек, с неразрывным пробелом → обычный). */
export function fmtKzt(tiyn) {
  return `${Math.trunc(tiyn / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;
}

/** Подпись под главной цифрой. */
export function priceCaption(locations, tills, yearly) {
  const l = `${locations} ${plural(locations, 'точка', 'точки', 'точек')}`;
  const t = `${tills} ${plural(tills, 'касса', 'кассы', 'касс')} на точке`;
  return yearly ? `${l}, ${t} · оплата за год` : `${l}, ${t} · помесячно`;
}

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

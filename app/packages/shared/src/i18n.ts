// packages/shared/src/i18n.ts
// Локализация ru/kk. Обещание мастер-плана: казахский — не перевод «потом»,
// а ядро. Paloma — единственная с kk-документацией (🏆 в сравнении);
// у нас kk прямо в интерфейсе кассы и бэк-офиса.
// Проверка полноты словаря — в тестах: каждый ru-ключ обязан иметь kk.

export type Lang = 'ru' | 'kk';

export const STRINGS = {
  // ── Касса: вход и смена ──
  'pin.enter': { ru: 'Введите PIN', kk: 'PIN енгізіңіз' },
  'pin.wrong': { ru: 'Неверный PIN', kk: 'PIN қате' },
  'shift.open': { ru: 'Открыть смену', kk: 'Ауысымды ашу' },
  'shift.close': { ru: 'Закрыть смену', kk: 'Ауысымды жабу' },
  'shift.opening_cash': { ru: 'Размен на старте', kk: 'Бастапқы ұсақ ақша' },
  'shift.expected': { ru: 'Должно быть в кассе', kk: 'Кассада болуы тиіс' },
  'shift.actual': { ru: 'Фактически в кассе', kk: 'Кассадағы нақты сома' },
  'shift.discrepancy': { ru: 'Расхождение', kk: 'Айырма' },

  // ── Касса: заказ ──
  'order.new': { ru: 'Новый заказ', kk: 'Жаңа тапсырыс' },
  'order.number': { ru: 'Заказ №', kk: 'Тапсырыс №' },
  'order.guests': { ru: 'Гостей', kk: 'Қонақтар' },
  'order.table': { ru: 'Стол', kk: 'Үстел' },
  'order.dine_in': { ru: 'В зале', kk: 'Залда' },
  'order.takeout': { ru: 'С собой', kk: 'Өзімен бірге' },
  'order.delivery': { ru: 'Доставка', kk: 'Жеткізу' },
  'order.search': { ru: 'Поиск…', kk: 'Іздеу…' },
  'order.all_categories': { ru: 'Все', kk: 'Барлығы' },
  'order.to_kitchen': { ru: 'На кухню', kk: 'Асханаға' },
  'order.stop': { ru: 'СТОП', kk: 'СТОП' },
  'order.remove_reason': { ru: 'Укажите причину удаления', kk: 'Жою себебін көрсетіңіз' },
  'order.pay': { ru: 'Оплата', kk: 'Төлем' },

  // ── Касса: оплата ──
  'pay.due': { ru: 'К оплате', kk: 'Төлемге' },
  'pay.tendered': { ru: 'Получено', kk: 'Алынды' },
  'pay.change': { ru: 'Сдача', kk: 'Қайтарым' },
  'pay.exact': { ru: 'Без сдачи', kk: 'Қайтарымсыз' },
  'pay.cash': { ru: 'Наличные', kk: 'Қолма-қол' },
  'pay.card_hint': { ru: 'Сумма уйдёт на терминал автоматически', kk: 'Сома терминалға автоматты түрде жіберіледі' },
  'pay.qr_hint': { ru: 'Покажите QR гостю', kk: 'QR-ды қонаққа көрсетіңіз' },
  'pay.done': { ru: 'Готово', kk: 'Дайын' },
  'pay.back': { ru: 'Назад', kk: 'Артқа' },
  'pay.refund_reason': { ru: 'Причина возврата обязательна', kk: 'Қайтару себебі міндетті' },

  // ── Касса: офлайн ──
  'sync.online': { ru: 'В сети', kk: 'Желіде' },
  'sync.sending': { ru: 'Отправка…', kk: 'Жіберілуде…' },
  'sync.offline': { ru: 'Офлайн · в очереди', kk: 'Офлайн · кезекте' },
  'sync.fiscal_queued': { ru: 'Чек будет пробит при появлении сети', kk: 'Чек желі пайда болғанда өткізіледі' },

  // ── Бэк-офис: навигация задач ──
  'nav.today': { ru: 'Сегодня', kk: 'Бүгін' },
  'nav.how_it_goes': { ru: 'Как идут дела', kk: 'Жағдай қалай' },
  'nav.menu': { ru: 'Меню', kk: 'Мәзір' },
  'nav.techcards': { ru: 'Техкарты и фудкост', kk: 'Техкарталар және фудкост' },
  'nav.stock': { ru: 'Склад', kk: 'Қойма' },
  'nav.supply': { ru: 'Принять поставку', kk: 'Жеткізілімді қабылдау' },
  'nav.inventory': { ru: 'Провести инвентаризацию', kk: 'Түгендеу жүргізу' },
  'nav.money': { ru: 'Деньги', kk: 'Ақша' },
  'nav.pnl': { ru: 'Прибыль (P&L)', kk: 'Пайда (P&L)' },
  'nav.guests': { ru: 'Гости', kk: 'Қонақтар' },
  'nav.staff': { ru: 'Сотрудники', kk: 'Қызметкерлер' },

  // ── Дашборд ──
  'dash.revenue_today': { ru: 'Выручка сегодня', kk: 'Бүгінгі түсім' },
  'dash.vs_yesterday': { ru: 'ко вчера', kk: 'кешеге қарағанда' },
  'dash.checks': { ru: 'Чеки', kk: 'Чектер' },
  'dash.avg_check': { ru: 'средний', kk: 'орташа' },
  'dash.attention': { ru: 'Требует внимания', kk: 'Назар аударыңыз' },
  'dash.all_good': { ru: 'Всё спокойно 👌', kk: 'Бәрі жақсы 👌' },
  'dash.pos_offline': { ru: 'Кассы не в сети', kk: 'Кассалар желіде емес' },

  // ── Онбординг ──
  'onb.title': { ru: 'До первого чека', kk: 'Алғашқы чекке дейін' },
  'onb.min': { ru: 'мин', kk: 'мин' },
  'onb.setup': { ru: 'Настроить', kk: 'Баптау' },
  'onb.done': { ru: 'Готово! Откройте смену на кассе и пробейте первый чек.', kk: 'Дайын! Кассада ауысымды ашып, алғашқы чекті өткізіңіз.' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang): string {
  return STRINGS[key]?.[lang] ?? STRINGS[key]?.ru ?? key;
}

/** Проверка полноты: каждый ключ имеет и ru, и kk непустые. */
export function i18nGaps(): string[] {
  const gaps: string[] = [];
  for (const [k, v] of Object.entries(STRINGS)) {
    if (!v.ru?.trim()) gaps.push(`${k}: нет ru`);
    if (!v.kk?.trim()) gaps.push(`${k}: нет kk`);
  }
  return gaps;
}

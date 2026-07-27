// packages/shared/src/permissions.ts
// Словарь прав платформы. Группировка по операциям — урок QuickResto
// (Кассовые операции / Работа с заказом / CRM / Сервисные), состав пунктов —
// объединение прав всех 5 конкурентов, чтобы глубина была не ниже лучшего.
//
// ОБНОВЛЕНО (дизайн-ревизия): ЧЕТЫРЕ состояния права вместо трёх.
// Раньше мы склеивали два разных сценария в одно 'pin'. QuickResto различает
// их точно, и разница принципиальная:
//   • «Повторная авторизация» — сотрудник подтверждает СВОИМ PIN. Защита от
//     терминала, брошенного без присмотра с открытой сменой: любой прохожий
//     не оформит возврат от имени кассира.
//   • «Повышение привилегий» — нужен PIN сотрудника СТАРШЕЙ должности.
//     Кассир физически не может сам удалить позицию после отправки на кухню.
// Первое защищает от посторонних, второе — от самого сотрудника.

export type PermissionState =
  | 'allowed'       // работает сразу
  | 'self_pin'      // подтвердить своим PIN (терминал без присмотра)
  | 'elevated_pin'  // подтвердить PIN старшего (контроль злоупотреблений)
  | 'denied';       // раздел/действие не отображается вовсе

/** Человеческие подписи состояний — для редактора роли в бэк-офисе. */
export const PERMISSION_STATE_LABELS: Record<PermissionState, { short: string; hint: string }> = {
  allowed: { short: 'Разрешено', hint: 'просто работает' },
  self_pin: { short: 'Своим PIN', hint: 'подтверждает своим кодом' },
  elevated_pin: { short: 'PIN старшего', hint: 'нужен код менеджера' },
  denied: { short: 'Запрещено', hint: 'раздел не показывается' },
};

export const PERMISSIONS = {
  // ── Кассовые операции (QuickResto: "Кассовые операции")
  'cash.shift.open': 'Открытие смены',
  'cash.shift.close': 'Закрытие смены и Z-отчёт',
  'cash.xreport': 'Выручка за смену',
  'cash.in': 'Внесение и изъятие денег',
  'cash.out': 'Инкассация',

  // ── Заказ (QuickResto: "Работа с заказом"; Poster: опасные действия под PIN)
  'order.create': 'Создание заказа',
  'order.item.remove': 'Удаление позиции после кухни',
  'order.cancel': 'Удаление позиции до кухни',
  'order.discount.manual': 'Скидка на чек',
  'order.reopen': 'Перенос заказа на другой стол',
  'order.refund': 'Возврат по чеку',
  'order.split': 'Печать копии чека',

  // ── CRM
  'crm.customer.view': 'База гостей',
  'crm.customer.edit': 'Экспорт базы гостей',
  'crm.bonus.adjust': 'Изменение бонусов',

  // ── Бэк-офис: меню и склад
  'menu.edit': 'Изменение техкарты',
  'stock.supply': 'Приём поставки',
  'stock.writeoff': 'Списание и порча',
  'stock.inventory': 'Инвентаризация',
  'stock.transfer': 'Изменение стоп-листа',

  // ── Финансы и отчёты
  'finance.view': 'Отчёт о прибыли',
  'finance.edit': 'Себестоимость и закупки',
  'reports.view': 'Журнал действий',

  // ── Администрирование
  'admin.employees': 'Сотрудники и PIN',
  'admin.settings': 'Настройки точки',
  'admin.billing': 'Оплата тарифа',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type RolePermissions = Partial<Record<PermissionKey, PermissionState>>;

/** Группы прав для редактора роли (модель QuickResto: права читаются
 *  разделами, а не сплошным списком из 27 строк). */
/**
 * Короткое пояснение к каждому праву — ТОЧНО из макета «Бэк-офис — Сотрудники и роли».
 * Показывается серой строкой под названием: владелец понимает, что именно он выдаёт,
 * не открывая документацию.
 */
export const PERMISSION_HINTS: Partial<Record<PermissionKey, string>> = {
  'cash.shift.open': 'внесение размена',
  'cash.shift.close': 'с пересчётом наличных',
  'cash.xreport': 'своя смена',
  'cash.in': 'деньги из ящика',
  'cash.out': 'вынос денег из кассы',
  'order.create': 'новый чек, стол, навынос',
  'order.item.remove': 'блюдо уже готовится',
  'order.cancel': 'заказ ещё не отправлен',
  'order.discount.manual': 'вручную, не по лояльности',
  'order.reopen': 'вместе с позициями',
  'order.refund': 'с позициями',
  'order.split': 'дубликат для гостя',
  'stock.supply': 'накладная и цены',
  'stock.inventory': 'слепой пересчёт',
  'stock.writeoff': 'уходит в расходы',
  'stock.transfer': 'блюдо кончилось',
  'menu.edit': 'состав и граммовка',
  'finance.view': 'налог 3% и чистая',
  'finance.edit': 'цены поставщиков',
  'reports.view': 'кто что делал',
  'crm.customer.view': 'телефоны и история',
  'crm.customer.edit': 'выгрузка в файл',
  'crm.bonus.adjust': 'начислить или списать',
  'admin.employees': 'добавить и заблокировать',
  'admin.settings': 'название, часы, зал',
  'admin.billing': 'счёт и продление',
};

/** Сводка по роли — из макета: «12 из 30 открыто · 6 скрыто». */
export function permissionsSummary(role: RolePermissions, allKeys: PermissionKey[]) {
  let open = 0, hidden = 0, pin = 0;
  for (const k of allKeys) {
    const s = role[k] ?? 'denied';
    if (s === 'allowed') open++;
    else if (s === 'denied') hidden++;
    else pin++;
  }
  return { total: allKeys.length, open, hidden, pin };
}

/** Сколько прав отличается от пресета — из макета «Изменено прав: N». */
export function diffFromPreset(role: RolePermissions, preset: RolePermissions, allKeys: PermissionKey[]): number {
  return allKeys.filter((k) => (role[k] ?? 'denied') !== (preset[k] ?? 'denied')).length;
}

export const PERMISSION_GROUPS: { id: string; name: string; keys: PermissionKey[] }[] = [
  { id: 'cash', name: 'Кассовые операции', keys: ['cash.shift.open', 'cash.shift.close', 'cash.xreport', 'cash.in', 'cash.out'] },
  { id: 'order', name: 'Работа с заказом', keys: ['order.create', 'order.item.remove', 'order.cancel', 'order.discount.manual', 'order.reopen', 'order.refund', 'order.split'] },
  { id: 'crm', name: 'Гости и CRM', keys: ['crm.customer.view', 'crm.customer.edit', 'crm.bonus.adjust'] },
  { id: 'stock', name: 'Склад', keys: ['menu.edit', 'stock.supply', 'stock.writeoff', 'stock.inventory', 'stock.transfer'] },
  { id: 'finance', name: 'Финансы', keys: ['finance.view', 'finance.edit', 'reports.view'] },
  { id: 'admin', name: 'Администрирование', keys: ['admin.employees', 'admin.settings', 'admin.billing'] },
];

// ═══════════════ ПРОВЕРКА ПРАВА ═══════════════
// Раньше функции не было вовсе — guard читал состояние напрямую.

/** Состояние права для роли. Право, не указанное в роли, запрещено
 *  (безопасное умолчание: забыли выдать — значит нельзя). */
export function resolvePermission(role: RolePermissions, key: PermissionKey): PermissionState {
  return role[key] ?? 'denied';
}

export function isAllowed(state: PermissionState): boolean {
  return state !== 'denied';
}

/** Нужен ли ввод PIN и ЧЕЙ именно. Ответ движет UI: какой заголовок
 *  показать в окне подтверждения. */
export function pinRequirement(state: PermissionState): null | { who: 'self' | 'elevated'; title: string } {
  if (state === 'self_pin') return { who: 'self', title: 'Подтвердите своим PIN' };
  if (state === 'elevated_pin') return { who: 'elevated', title: 'Нужен PIN менеджера' };
  return null;
}

/** Иерархия ролей: кто может подтверждать «повышение привилегий».
 *  Больше число — выше должность. */
export const ROLE_RANK: Record<string, number> = {
  OWNER: 100, MANAGER: 70, CASHIER: 40, WAITER: 30, COOK: 20, COURIER: 10,
};

/** Может ли сотрудник роли confirmerRole подтвердить действие
 *  сотрудника роли actorRole. Строго выше по рангу. */
export function canElevate(actorRole: string, confirmerRole: string): boolean {
  return (ROLE_RANK[confirmerRole] ?? 0) > (ROLE_RANK[actorRole] ?? 0);
}

/** Полная проверка действия: что делать интерфейсу.
 *  Возвращает решение, а не бросает — UI сам решает, как показать. */
export function checkAction(
  role: RolePermissions, key: PermissionKey,
): { effect: 'run' | 'ask_self_pin' | 'ask_elevated_pin' | 'hide'; label?: string } {
  const state = resolvePermission(role, key);
  if (state === 'denied') return { effect: 'hide' };
  if (state === 'self_pin') return { effect: 'ask_self_pin', label: PERMISSION_STATE_LABELS.self_pin.short };
  if (state === 'elevated_pin') return { effect: 'ask_elevated_pin', label: PERMISSION_STATE_LABELS.elevated_pin.short };
  return { effect: 'run' };
}

// ═══════════════ ПРЕСЕТЫ РОЛЕЙ ═══════════════
// Пресеты ролей — объединение практик всех 5 (Paloma: кассир/официант/повар/
// админ зала; QuickResto/Poster: менеджер, владелец; r_keeper: курьер в Delivery)

export const ROLE_PRESETS: Record<string, { name: string; permissions: RolePermissions }> = {
  OWNER: {
    name: 'Владелец',
    permissions: Object.fromEntries(
      Object.keys(PERMISSIONS).map((k) => [k, 'allowed']),
    ) as RolePermissions,
  },
  MANAGER: {
    name: 'Менеджер',
    permissions: {
      'cash.shift.open': 'allowed', 'cash.shift.close': 'allowed',
      'cash.xreport': 'allowed', 'cash.in': 'allowed', 'cash.out': 'allowed',
      'order.create': 'Создание заказа', 'order.item.remove': 'Удаление позиции после кухни',
      'order.cancel': 'Удаление позиции до кухни', 'order.discount.manual': 'Скидка на чек',
      'order.reopen': 'Перенос заказа на другой стол', 'order.refund': 'Возврат по чеку', 'order.split': 'Печать копии чека',
      'crm.customer.view': 'База гостей', 'crm.customer.edit': 'Экспорт базы гостей',
      'crm.bonus.adjust': 'Изменение бонусов',
      'menu.edit': 'Изменение техкарты', 'stock.supply': 'Приём поставки', 'stock.writeoff': 'Списание и порча',
      'stock.inventory': 'Инвентаризация', 'stock.transfer': 'Изменение стоп-листа',
      'finance.view': 'Отчёт о прибыли', 'reports.view': 'Журнал действий',
    },
  },
  CASHIER: {
    name: 'Кассир',
    permissions: {
      'cash.shift.open': 'allowed',
      // Закрытие смены и X-отчёт — СВОИМ PIN: фиксируем, кто именно снял
      // отчёт и закрыл смену (защита брошенного терминала)
      'cash.shift.close': 'self_pin', 'cash.xreport': 'self_pin',
      'cash.in': 'allowed',
      // Изъятие денег — PIN старшего: кассир не выносит наличные сам
      'cash.out': 'elevated_pin',
      'order.create': 'Создание заказа', 'order.split': 'Печать копии чека',
      // Опасные действия — PIN менеджера (урок Poster security-settings)
      'order.item.remove': 'Удаление позиции после кухни', 'order.cancel': 'Удаление позиции до кухни',
      'order.discount.manual': 'Скидка на чек', 'order.reopen': 'Перенос заказа на другой стол',
      'order.refund': 'Возврат по чеку',
      'crm.customer.view': 'База гостей',
    },
  },
  WAITER: {
    name: 'Официант',
    permissions: {
      'order.create': 'Создание заказа', 'order.split': 'Печать копии чека',
      'order.item.remove': 'Удаление позиции после кухни', 'order.cancel': 'Удаление позиции до кухни',
      'order.discount.manual': 'Скидка на чек', 'order.refund': 'Возврат по чеку',
      'crm.customer.view': 'База гостей',
    },
  },
  COOK: { name: 'Повар', permissions: {} }, // видит только кухонный экран
  COURIER: { name: 'Курьер', permissions: { 'order.create': 'Создание заказа' } },
};

// ── Договор синхронизации (офлайн-ядро) ─────────────────────────
// Типы событий этапа 0; следующие этапы расширяют словарь.
export type SyncEventType =
  | 'terminal.registered'
  | 'employee.pin_login'
  | 'shift.opened'
  | 'shift.closed';

export interface SyncEvent<T = unknown> {
  eventId: string;      // ULID с устройства — ключ идемпотентности
  type: SyncEventType | string;
  terminalId: string;
  createdAt: string;    // ISO, время устройства
  payload: T;
}

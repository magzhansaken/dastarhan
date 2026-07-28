// packages/shared/src/product-map.ts
// Карта продукта: одиннадцать интерфейсов, одна ссылка.
// Нужна для демонстрации и для навигации между приложениями.

export const PRODUCT_MAP = {
  title: 'Индекс · все экраны продукта',
  claim: 'Одиннадцать интерфейсов, одна ссылка',
  openLabel: 'Открыть →',

  // Порядок показа не случайный: владелец решает за три минуты,
  // и решает по кассе, а не по списку функций
  howToShow: {
    title: 'Как показывать',
    rule: 'Владелец решает за три минуты — дайте ему касса → дашборд → цена',
    order: [
      'Экран заказа на кассе — пусть нажмёт сам',
      'Дашборд «Как идут дела»',
      'Тарифы с калькулятором',
    ],
    forDealer: 'Дилеру — кабинет и комиссию',
    forInvestor: 'Инвестору — Пульс и «Здоровье клиентов»',
  },

  designSystem: 'Дизайн-система и план',
} as const;

/** Интерфейсы продукта с адресами в боевой системе. */
export const INTERFACES = [
  { key: 'site', name: 'Сайт', url: '/', theme: 'light',
    users: 'посетитель и будущий клиент' },
  { key: 'register', name: 'Регистрация', url: '/pages/register.html', theme: 'light',
    users: 'новый владелец' },
  { key: 'pos', name: 'Касса', url: 'app', theme: 'dark',
    users: 'кассир и официант' },
  { key: 'kds', name: 'Кухня', url: '/kds/', theme: 'dark',
    users: 'повар' },
  { key: 'courier', name: 'Курьер', url: '/courier/', theme: 'dark',
    users: 'курьер' },
  { key: 'guest', name: 'QR-меню гостя', url: '/menu/', theme: 'light',
    users: 'гость за столом' },
  { key: 'office', name: 'Бэк-офис', url: '/office/', theme: 'light',
    users: 'владелец и менеджер' },
  { key: 'billing', name: 'Биллинг клиента', url: '/office/#billing', theme: 'light',
    users: 'владелец' },
  { key: 'admin', name: 'Админка платформы', url: '/admin/', theme: 'light',
    users: 'команда Dastarhan' },
  { key: 'dealer', name: 'Кабинет дилера', url: '/dealer/', theme: 'light',
    users: 'партнёры' },
  { key: 'telegram', name: 'Telegram-бот', url: 'tg', theme: 'light',
    users: 'гость доставки' },
] as const;

/** Группы для навигации, как в макете. */
export const INTERFACE_GROUPS = [
  { no: '01', title: 'Коммерческий сайт', keys: ['site'] },
  { no: '02', title: 'Регистрация и онбординг', keys: ['register'] },
  { no: '03', title: 'Касса и кухня', keys: ['pos', 'kds'] },
  { no: '04', title: 'Мобильные интерфейсы', keys: ['courier', 'guest', 'telegram'] },
  { no: '05', title: 'Бэк-офис', keys: ['office', 'billing'] },
  { no: '06', title: 'Админки вендора и дилера', keys: ['admin', 'dealer'] },
] as const;

export const PRODUCT_STATS = {
  interfaces: 11,
  screens: 62,
  languages: 2,
  waves: 4,
} as const;

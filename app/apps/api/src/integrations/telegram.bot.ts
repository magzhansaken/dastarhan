// apps/api/src/integrations/telegram.bot.ts
// Telegram-бот заказов — главный гостевой канал КЗ (стратегия Этапа 6).
// Образец флоу — QuickResto (19 статей): меню → блюда → корзина → оплата.
// Наше отличие: оплата Kaspi-ссылкой (у QR только росс. процессинги).
// Архитектура: ЧИСТАЯ машина диалога (тестируема) + тонкий webhook-адаптер.

import { normalizePhoneKz } from '../guests/loyalty.logic';

export type Money = number;

export type ChatStep = 'START' | 'MENU' | 'ITEM' | 'CART' | 'PHONE' | 'PAY_WAIT' | 'DONE';

export interface CartLine { productId: string; name: string; price: Money; qty: number }

export interface ChatState {
  step: ChatStep;
  categoryId?: string;
  cart: CartLine[];
  phone?: string;
  orderId?: string;
}

export interface BotReply {
  text: string;
  keyboard?: { label: string; data: string }[][];
  payLink?: string;
}

export interface MenuData {
  categories: { id: string; name: string }[];
  items: { productId: string; name: string; price: Money; categoryId: string; stopped?: boolean }[];
}

export const START_STATE: ChatState = { step: 'START', cart: [] };

const fmt = (t: Money) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

export function cartTotal(cart: CartLine[]): Money {
  return cart.reduce((s, l) => s + l.price * l.qty, 0);
}

/** Один вход — одно событие: текст или callback-data кнопки. */
export function botStep(state: ChatState, input: string, menu: MenuData): { state: ChatState; reply: BotReply } {
  const s: ChatState = { ...state, cart: state.cart.map((l) => ({ ...l })) };

  if (input === '/start' || input === 'home') {
    return {
      state: { ...s, step: 'MENU', categoryId: undefined },
      reply: {
        text: 'Сәлеметсіз бе! Что закажем? 👇',
        keyboard: [
          ...chunk(menu.categories.map((c) => ({ label: c.name, data: `cat:${c.id}` })), 2),
          [{ label: `🛒 Корзина${s.cart.length ? ` (${s.cart.length})` : ''}`, data: 'cart' }],
        ],
      },
    };
  }
  if (input === 'cart') return cartView(s);

  if (input.startsWith('cat:')) {
    const categoryId = input.slice(4);
    const items = menu.items.filter((i) => i.categoryId === categoryId && !i.stopped);
    return {
      state: { ...s, step: 'MENU', categoryId },
      reply: {
        text: 'Выбирайте:',
        keyboard: [
          ...items.map((i) => [{ label: `${i.name} · ${fmt(i.price)}`, data: `add:${i.productId}` }]),
          [{ label: '⬅ Категории', data: 'home' }, { label: '🛒 Корзина', data: 'cart' }],
        ],
      },
    };
  }

  if (input.startsWith('add:')) {
    const id = input.slice(4);
    const item = menu.items.find((i) => i.productId === id);
    if (!item || item.stopped)
      return { state: s, reply: { text: 'Увы, закончилось 😔 Выберите другое.' } };
    const line = s.cart.find((l) => l.productId === id);
    if (line) line.qty += 1;
    else s.cart.push({ productId: id, name: item.name, price: item.price, qty: 1 });
    return {
      state: { ...s, step: 'MENU' },
      reply: {
        text: `✓ ${item.name} в корзине. Итого: ${fmt(cartTotal(s.cart))}`,
        keyboard: [[
          { label: '➕ Ещё', data: `cat:${s.categoryId ?? menu.categories[0]?.id}` },
          { label: '🛒 Оформить', data: 'cart' },
        ]],
      },
    };
  }

  if (input.startsWith('rm:')) {
    s.cart = s.cart.filter((l) => l.productId !== input.slice(3));
    return cartView(s);
  }

  if (input === 'checkout') {
    if (!s.cart.length) return cartView(s);
    return { state: { ...s, step: 'PHONE' },
      reply: { text: 'Напишите ваш номер телефона (для бонусов и связи):' } };
  }

  if (s.step === 'PHONE') {
    try {
      const phone = normalizePhoneKz(input);
      return {
        state: { ...s, step: 'PAY_WAIT', phone },
        reply: {
          text: `Заказ на ${fmt(cartTotal(s.cart))}. Оплатите по ссылке Kaspi 👇`,
          payLink: 'PENDING_KASPI_LINK', // подставит webhook-слой из kaspi.qr
        },
      };
    } catch {
      return { state: s, reply: { text: 'Не понял номер 😅 Пример: 8 707 123 45 67' } };
    }
  }

  if (input === 'paid') {
    return { state: { ...s, step: 'DONE' },
      reply: { text: '🎉 Оплата получена! Заказ передан на кухню. Напишем, когда будет готов.' } };
  }

  return { state: s, reply: { text: 'Нажмите /start чтобы открыть меню' } };
}

function cartView(s: ChatState): { state: ChatState; reply: BotReply } {
  if (!s.cart.length)
    return { state: { ...s, step: 'MENU' },
      reply: { text: 'Корзина пуста. Загляните в меню!', keyboard: [[{ label: '📋 Меню', data: 'home' }]] } };
  return {
    state: { ...s, step: 'CART' },
    reply: {
      text: s.cart.map((l) => `${l.name} ×${l.qty} — ${fmt(l.price * l.qty)}`).join('\n')
        + `\n\nИтого: ${fmt(cartTotal(s.cart))}`,
      keyboard: [
        ...s.cart.map((l) => [{ label: `✕ ${l.name}`, data: `rm:${l.productId}` }]),
        [{ label: '✅ Оформить', data: 'checkout' }, { label: '⬅ Меню', data: 'home' }],
      ],
    },
  };
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

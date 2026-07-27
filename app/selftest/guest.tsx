// apps/guest/src/GuestMenu.tsx
// P1-11: QR-меню гостя. Анализ: QR Showcase (24 ст.: QR-код на каждое
// посадочное место — стол/VIP/ложа; сайт: поиск → заказ → оплата; предзаказ
// с уведомлением; отзывы), Poster QR (меню по QR/короткой ссылке,
// автосинхронизация с кассой — «меню всегда актуально»). Наши профи-добавки:
//  1) ЯЗЫК ГОСТЯ ru/kk одним переключателем — nameKk уже в схеме меню;
//     ни QR, ни Poster казахский не отдают
//  2) «ПОЗВАТЬ ОФИЦИАНТА» — кнопка со стола (событие на кассу; у QR только
//     заказ, у Poster только просмотр)
//  3) стоп-лист скрывает блюдо У ГОСТЯ автоматически (синк Poster доведён
//     до стопов) — гость не закажет то, чего нет
//  4) бейджи 🌶острое/🌿вег из тегов — фильтр диеты в одно касание
import React, { useMemo, useState } from 'react';

export type Money = number;
export type Lang = 'ru' | 'kk';

// ═══════════════ ДАННЫЕ И VIEW-MODEL ═══════════════

export interface GuestMenuItem {
  productId: string;
  name: string; nameKk?: string;
  description?: string; descriptionKk?: string;
  price: Money;
  categoryId: string;
  photoUrl?: string;
  tags?: string[];          // 'spicy' | 'veg' | 'halal' | ...
  stopped?: boolean;        // из стоп-листа — скрыть у гостя
}

export interface GuestCategory { id: string; name: string; nameKk?: string }

export function itemName(i: GuestMenuItem, lang: Lang): string {
  return lang === 'kk' && i.nameKk ? i.nameKk : i.name;
}
export function catName(c: GuestCategory, lang: Lang): string {
  return lang === 'kk' && c.nameKk ? c.nameKk : c.name;
}

/** Меню гостя: стоп скрыт, фильтр категории/тега, поиск по обоим языкам. */
export function guestMenu(
  items: GuestMenuItem[], categoryId: string | null, tag: string | null, q: string,
): GuestMenuItem[] {
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
  const query = norm(q.trim());
  return items.filter((i) => {
    if (i.stopped) return false;                       // гость не видит стопы
    if (categoryId && i.categoryId !== categoryId) return false;
    if (tag && !(i.tags ?? []).includes(tag)) return false;
    if (query && !norm(i.name).includes(query)
      && !norm(i.nameKk ?? '').includes(query)) return false;
    return true;
  });
}

export const TAG_BADGES: Record<string, string> = {
  spicy: '🌶', veg: '🌿', halal: '☪', new: '✨', hit: '🔥',
};

// корзина гостя
export interface GuestCartLine { productId: string; name: string; price: Money; qty: number }

export function cartAdd(cart: GuestCartLine[], i: GuestMenuItem, lang: Lang): GuestCartLine[] {
  const ex = cart.find((l) => l.productId === i.productId);
  if (ex) return cart.map((l) => l.productId === i.productId ? { ...l, qty: l.qty + 1 } : l);
  return [...cart, { productId: i.productId, name: itemName(i, lang), price: i.price, qty: 1 }];
}

export function cartTotal(cart: GuestCartLine[]): Money {
  return cart.reduce((s, l) => s + l.price * l.qty, 0);
}

/** Заказ со стола: payload на API (создаёт заказ DINE_IN на стол токена). */
export function buildTableOrder(tableToken: string, cart: GuestCartLine[], comment?: string) {
  if (!cart.length) throw new Error('EMPTY_CART');
  return {
    tableToken,
    items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
    comment,
    source: 'qr_table' as const,
  };
}

const L = {
  menu: { ru: 'Меню', kk: 'Мәзір' },
  search: { ru: 'Поиск…', kk: 'Іздеу…' },
  all: { ru: 'Все', kk: 'Барлығы' },
  order: { ru: 'Заказать на стол', kk: 'Үстелге тапсырыс беру' },
  call: { ru: 'Позвать официанта', kk: 'Даяшыны шақыру' },
  called: { ru: 'Официант идёт к вам 👌', kk: 'Даяшы келе жатыр 👌' },
  total: { ru: 'Итого', kk: 'Барлығы' },
  table: { ru: 'Стол', kk: 'Үстел' },
};

const fmt = (t: Money) => `${Math.trunc(t / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

// ═══════════════ СТРАНИЦА ГОСТЯ ═══════════════

export function GuestMenuPage(props: {
  shopName: string;
  tableName: string;
  tableToken: string;
  categories: GuestCategory[];
  items: GuestMenuItem[];
  selfOrderEnabled: boolean;             // владелец может выключить заказ со стола
  onSubmitOrder: (payload: ReturnType<typeof buildTableOrder>) => void;
  onCallWaiter: (tableToken: string) => void;
}) {
  const [lang, setLang] = useState<Lang>('ru');
  const [cat, setCat] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<GuestCartLine[]>([]);
  const [waiterCalled, setWaiterCalled] = useState(false);
  const items = useMemo(() => guestMenu(props.items, cat, tag, q), [props.items, cat, tag, q]);

  return (
    <div className="guest-page">
      <header className="g-head">
        <div>
          <h1>{props.shopName}</h1>
          <span className="g-table">{L.table[lang]} {props.tableName}</span>
        </div>
        <div className="lang-switch">
          <button className={lang === 'ru' ? 'on' : ''} onClick={() => setLang('ru')}>Рус</button>
          <button className={lang === 'kk' ? 'on' : ''} onClick={() => setLang('kk')}>Қаз</button>
        </div>
      </header>

      <button className="btn call-waiter"
        onClick={() => { props.onCallWaiter(props.tableToken); setWaiterCalled(true); }}>
        {waiterCalled ? L.called[lang] : `🔔 ${L.call[lang]}`}
      </button>

      <input className="g-search" placeholder={L.search[lang]} value={q}
        onChange={(e) => setQ(e.target.value)} />

      <div className="g-cats">
        <button className={cat === null ? 'on' : ''} onClick={() => setCat(null)}>{L.all[lang]}</button>
        {props.categories.map((c) => (
          <button key={c.id} className={cat === c.id ? 'on' : ''}
            onClick={() => setCat(c.id)}>{catName(c, lang)}</button>
        ))}
      </div>
      <div className="g-tags">
        {Object.entries(TAG_BADGES).map(([t, b]) => (
          <button key={t} className={`tagf ${tag === t ? 'on' : ''}`}
            onClick={() => setTag(tag === t ? null : t)}>{b}</button>
        ))}
      </div>

      <div className="g-items">
        {items.map((i) => (
          <article key={i.productId} className="g-item">
            {i.photoUrl && <img src={i.photoUrl} alt="" className="g-photo" />}
            <div className="g-item-body">
              <h3>{itemName(i, lang)}
                {(i.tags ?? []).map((t) => <span key={t} className="g-badge">{TAG_BADGES[t] ?? ''}</span>)}
              </h3>
              {(lang === 'kk' ? i.descriptionKk ?? i.description : i.description) && (
                <p className="g-desc">{lang === 'kk' ? i.descriptionKk ?? i.description : i.description}</p>
              )}
              <div className="g-item-foot">
                <b className="money">{fmt(i.price)}</b>
                {props.selfOrderEnabled && (
                  <button className="btn g-add" onClick={() => setCart(cartAdd(cart, i, lang))}>+</button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {props.selfOrderEnabled && cart.length > 0 && (
        <footer className="g-cart">
          <span>{cart.reduce((s, l) => s + l.qty, 0)} поз · <b className="money">{fmt(cartTotal(cart))}</b></span>
          <button className="btn btn-ok"
            onClick={() => props.onSubmitOrder(buildTableOrder(props.tableToken, cart))}>
            {L.order[lang]}
          </button>
        </footer>
      )}
    </div>
  );
}

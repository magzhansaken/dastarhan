// apps/pos/src/ui/screens/PosScreens.tsx
// Экраны кассы. Обновлено ТОЧЬ-В-ТОЧЬ по макетам Claude Design:
// «Касса — Вход, зал и смены», «Касса — Заказ», «Касса — Оплата и сдача».
// Все подписи, состояния и вспомогательные блоки взяты из словарей макета
// (RU/KK), включая пустые состояния, подсказки сдачи, экраны Kaspi QR,
// терминала карты и смешанной оплаты.
import React, { useMemo, useState } from 'react';
import {
  PinVm, pinPress, pinReady, CatalogItem, filterCatalog, tileBadge,
  PaymentVm, paymentChange, paymentValid, quickTenderOptions, tenderPress,
  formatMoney, syncStatusLabel,
} from '../viewmodels';
import { OrderState, orderTotals } from '../../offline/orderReducer';

export type Lang = 'ru' | 'kk';

// ═══════════════ СЛОВАРЬ ЭКРАНОВ (из макетов) ═══════════════

export const T = {
  // общее
  hall:        { ru: 'Карта зала', kk: 'Зал картасы' },
  table:       { ru: 'Стол', kk: 'Үстел' },
  min:         { ru: 'мин', kk: 'мин' },
  offline:     { ru: 'Офлайн', kk: 'Офлайн' },
  inQueue:     { ru: 'в очереди', kk: 'кезекте' },
  waiter:      { ru: 'официант', kk: 'даяшы' },
  cashier:     { ru: 'кассир', kk: 'кассир' },
  online:      { ru: 'чеки уходят', kk: 'чектер жіберілуде' },
  // заказ
  order:       { ru: 'Заказ', kk: 'Тапсырыс' },
  guests:      { ru: 'Гостей', kk: 'Қонақтар' },
  pos:         { ru: 'позиции', kk: 'позиция' },
  discount:    { ru: 'Скидка', kk: 'Жеңілдік' },
  total:       { ru: 'Итого', kk: 'Барлығы' },
  precheck:    { ru: 'Пречек', kk: 'Алдын ала есеп' },
  toKitchen:   { ru: 'На кухню', kk: 'Асханаға' },
  pay:         { ru: 'Оплата', kk: 'Төлем' },
  search:      { ru: 'Поиск блюда или кода', kk: 'Тағам немесе код іздеу' },
  stopList:    { ru: 'Стоп-лист', kk: 'Стоп-тізім' },
  stop:        { ru: 'Стоп', kk: 'Стоп' },
  quick:       { ru: 'Часто', kk: 'Жиі' },
  remove:      { ru: 'Убрать', kk: 'Алып тастау' },
  emptyT:      { ru: 'Заказ пустой', kk: 'Тапсырыс бос' },
  emptyD:      { ru: 'Нажмите блюдо справа — оно попадёт в чек. Первое касание уже считается.',
                 kk: 'Оң жақтағы тағамды басыңыз — ол чекке түседі.' },
  // оплата
  check:       { ru: 'Чек', kk: 'Чек' },
  subtotal:    { ru: 'Сумма', kk: 'Сома' },
  toPay:       { ru: 'К оплате', kk: 'Төлемге' },
  split:       { ru: 'Разделить', kk: 'Бөлу' },
  printCopy:   { ru: 'Копия чека', kk: 'Чек көшірмесі' },
  received:    { ru: 'Внесено наличными', kk: 'Қолма-қол енгізілді' },
  smartBills:  { ru: 'Купюрами', kk: 'Банкноттармен' },
  inDrawer:    { ru: 'В ящике сейчас', kk: 'Жәшікте қазір' },
  fiscal:      { ru: 'Фискализация', kk: 'Фискалдау' },
  fiscalOk:    { ru: 'Webkassa готова', kk: 'Webkassa дайын' },
  punch:       { ru: 'Пробить чек', kk: 'Чекті өткізу' },
  change:      { ru: 'Сдача', kk: 'Қайтарым' },
  noChange:    { ru: 'Без сдачи', kk: 'Қайтарымсыз' },
  notEnough:   { ru: 'Не хватает', kk: 'Жетіспейді' },
  enterAmount: { ru: 'Внесите сумму', kk: 'Соманы енгізіңіз' },
  changeHintReady: { ru: 'Отдайте сдачу и закройте чек. Купюры подсказаны под сумму заказа.',
                     kk: 'Қайтарымды беріп, чекті жабыңыз.' },
  changeHintNeed:  { ru: 'Нажмите купюру или наберите сумму на клавишах.',
                     kk: 'Банкнотты басыңыз немесе соманы теріңіз.' },
  cash:        { ru: 'Наличные', kk: 'Қолма-қол' },
  kaspi:       { ru: 'Kaspi QR', kk: 'Kaspi QR' },
  card:        { ru: 'Карта', kk: 'Карта' },
  mixed:       { ru: 'Смешанная', kk: 'Аралас' },
  hintCash:    { ru: 'без сдачи и с купюр', kk: 'қайтарымсыз және банкноттан' },
  hintKaspi:   { ru: 'QR или по номеру', kk: 'QR немесе нөмір бойынша' },
  hintCard:    { ru: 'терминал банка', kk: 'банк терминалы' },
  hintMixed:   { ru: 'несколько частей', kk: 'бірнеше бөлік' },
  showQr:      { ru: 'Покажите QR гостю', kk: 'QR-ды қонаққа көрсетіңіз' },
  qrHint:      { ru: 'Гость сканирует камерой Kaspi. Оплата придёт сама — экран сменится.',
                 kk: 'Қонақ Kaspi камерасымен сканерлейді.' },
  waiting:     { ru: 'Ждём оплату', kk: 'Төлемді күтудеміз' },
  waitingHint: { ru: 'Обычно 5–10 секунд', kk: 'Әдетте 5–10 секунд' },
  paidManually:{ ru: 'Отметить оплату вручную', kk: 'Төлемді қолмен белгілеу' },
  cardT:       { ru: 'Проведите карту на терминале', kk: 'Картаны терминалда өткізіңіз' },
  cardD:       { ru: 'Сумма уже отправлена на терминал. После одобрения чек пробьётся сам.',
                 kk: 'Сома терминалға жіберілді.' },
  cardA:       { ru: 'Повторить отправку', kk: 'Қайта жіберу' },
  mixedT:      { ru: 'Части оплаты', kk: 'Төлем бөліктері' },
  left:        { ru: 'Осталось внести', kk: 'Енгізу қалды' },
  // PIN
  pinEnter:    { ru: 'Введите PIN', kk: 'PIN енгізіңіз' },
  pinWrong:    { ru: 'Неверный PIN. Попробуйте снова или позовите владельца.',
                 kk: 'PIN қате. Қайталап көріңіз немесе иесін шақырыңыз.' },
} as const;

export type TKey = keyof typeof T;
export const t = (k: TKey, lang: Lang = 'ru'): string => T[k][lang];

// ═══════════════ ПЕРЕКЛЮЧАТЕЛЬ ЯЗЫКА (из макета — в шапке кассы) ═══════════════

export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang-toggle">
      <button className={lang === 'ru' ? 'on' : ''} onClick={() => onChange('ru')}>Рус</button>
      <button className={lang === 'kk' ? 'on' : ''} onClick={() => onChange('kk')}>Қаз</button>
    </div>
  );
}

// ═══════════════ PIN ═══════════════

export function PinScreen({ onSubmit, lang = 'ru' }: {
  onSubmit: (pin: string) => Promise<boolean>; lang?: Lang;
}) {
  const [vm, setVm] = useState<PinVm>({ digits: '' });
  const press = async (k: string) => {
    const next = pinPress(vm, k);
    setVm(next);
    if (k !== 'del' && pinReady(next) && next.digits.length === 4) {
      const ok = await onSubmit(next.digits);
      if (!ok) setVm({ digits: '', error: t('pinWrong', lang) });
    }
  };
  return (
    <div className="pin-screen">
      <div className="label-mono">{t('pinEnter', lang)}</div>
      <div className="pin-dots">{'●'.repeat(vm.digits.length).padEnd(4, '○')}</div>
      {vm.error && <div className="pin-error">{vm.error}</div>}
      <div className="numpad">
        {['1','2','3','4','5','6','7','8','9','','0','del'].map((k, i) => (
          <button key={k || `e${i}`} className="btn numpad-key" disabled={!k}
            onClick={() => press(k)}>{k === 'del' ? '⌫' : k}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════ СТАТУС ФИСКАЛИЗАЦИИ (бейдж из макета) ═══════════════

export type FiscalState = 'ok' | 'queued' | 'error' | 'off';

export function fiscalBadge(state: FiscalState, queued = 0, lang: Lang = 'ru'):
  { text: string; cls: string } {
  if (state === 'ok') return { text: `Webkassa · ${t('online', lang)}`, cls: 'fiscal' };
  if (state === 'queued') return { text: `Webkassa · ${queued} ${t('inQueue', lang)}`, cls: 'fiscal fiscal-off' };
  if (state === 'error') return { text: `Webkassa · ${t('notEnough', lang)}`, cls: 'fiscal fiscal-err' };
  return { text: 'Webkassa · —', cls: 'fiscal fiscal-off' };
}

// ═══════════════ ЗАКАЗ ═══════════════

export function OrderScreen(props: {
  order: OrderState;
  catalog: CatalogItem[];
  categories: { id: string; name: string; color?: string }[];
  online: boolean;
  unsyncedCount: number;
  fiscal?: FiscalState;
  cashierName?: string;
  tableName?: string;
  openedMinutes?: number;
  loyaltyLabel?: string;         // «Айгерим, гость» — из макета
  discountAmount?: number;
  frequentIds?: string[];        // раздел «Часто» из макета
  lang?: Lang;
  onLang?: (l: Lang) => void;
  onAdd: (p: CatalogItem) => void;
  onPay: () => void;
  onItemTap: (itemId: string) => void;
  onPrecheck?: () => void;
  onToKitchen?: () => void;
  onHall?: () => void;
  onStopList?: () => void;
}) {
  const lang = props.lang ?? 'ru';
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    if (cat === '__freq' && props.frequentIds?.length) {
      return props.catalog.filter((i) => props.frequentIds!.includes(i.productId));
    }
    return filterCatalog(props.catalog, cat === '__freq' ? null : cat, q);
  }, [props.catalog, cat, q, props.frequentIds]);
  const totals = orderTotals(props.order);
  const sync = syncStatusLabel(props.online, props.unsyncedCount);
  const fb = fiscalBadge(props.fiscal ?? 'ok', props.unsyncedCount, lang);
  const visible = props.order.items.filter((i) => !i.isRemoved);

  return (
    <div className="order-screen">
      <aside className="check-pane">
        <header className="check-head">
          <span>
            {t('order', lang)} №{props.order.number}
            {props.tableName && ` · ${t('table', lang)} ${props.tableName}`}
            {props.openedMinutes != null && ` · ${props.openedMinutes} ${t('min', lang)}`}
          </span>
          <span className={`sync sync-${sync.tone}`}>
            {props.online ? sync.text : `${t('offline', lang)} · ${props.unsyncedCount} ${t('inQueue', lang)}`}
          </span>
        </header>

        {props.loyaltyLabel && (
          <div className="ch-cashier" style={{ padding: '0 18px 6px' }}>👤 {props.loyaltyLabel}</div>
        )}

        {visible.length === 0 ? (
          <div className="state-empty">
            <b>{t('emptyT', lang)}</b>
            <span>{t('emptyD', lang)}</span>
          </div>
        ) : (
          <ul className="check-items">
            {visible.map((i) => (
              <li key={i.itemId} className="check-item" onClick={() => props.onItemTap(i.itemId)}>
                <span className="ci-name">{i.name}
                  {i.modifiers.length > 0 && (
                    <em className="ci-mods">{i.modifiers.map((m) => m.name).join(', ')}</em>
                  )}
                </span>
                <span className="ci-qty">×{i.qty}</span>
                <span className="ci-sum money">{formatMoney((i.unitPrice + i.modifiersPrice) * i.qty)}</span>
              </li>
            ))}
          </ul>
        )}

        <footer className="check-foot">
          <div className="pay-breakdown">
            <div><span>{visible.length} {t('pos', lang)}</span><span /></div>
            {!!props.discountAmount && (
              <div><span>{t('discount', lang)}</span>
                <span className="pb-discount">−{formatMoney(props.discountAmount)}</span></div>
            )}
          </div>
          <div className="check-total money">{formatMoney(totals.subtotal - (props.discountAmount ?? 0))}</div>
          <div className="pay-extra">
            <button className="pay-extra-btn" onClick={props.onPrecheck} disabled={!visible.length}>
              {t('precheck', lang)}
            </button>
            <button className="pay-extra-btn" onClick={props.onToKitchen} disabled={!visible.length}>
              {t('toKitchen', lang)}
            </button>
          </div>
          <button className="btn btn-ok pay-btn" disabled={!totals.itemsCount} onClick={props.onPay}>
            {t('pay', lang)}
          </button>
        </footer>
      </aside>

      <main className="catalog-pane">
        <div className="ch-badges" style={{ justifyContent: 'space-between' }}>
          <div className="ch-cashier">
            {props.onHall && (
              <button className="pay-extra-btn" style={{ minHeight: 40 }} onClick={props.onHall}>
                ← {t('hall', lang)}
              </button>
            )}
            {props.cashierName && <span>{props.cashierName} · {t('cashier', lang)}</span>}
          </div>
          <div className="ch-badges">
            <span className={fb.cls}>{fb.text}</span>
            {props.onLang && <LangToggle lang={lang} onChange={props.onLang} />}
          </div>
        </div>

        <div className="catalog-top">
          <input className="search" placeholder={t('search', lang)} value={q}
            onChange={(e) => setQ(e.target.value)} />
          <div className="cat-strip">
            <button className={`cat ${cat === null ? 'on' : ''}`} onClick={() => setCat(null)}>
              {lang === 'kk' ? 'Барлығы' : 'Все'}
            </button>
            {!!props.frequentIds?.length && (
              <button className={`cat ${cat === '__freq' ? 'on' : ''}`} onClick={() => setCat('__freq')}>
                ★ {t('quick', lang)}
              </button>
            )}
            {props.categories.map((c) => (
              <button key={c.id} className={`cat ${cat === c.id ? 'on' : ''}`}
                style={{ borderColor: c.color }} onClick={() => setCat(c.id)}>{c.name}</button>
            ))}
            {props.onStopList && (
              <button className="cat" onClick={props.onStopList}>{t('stopList', lang)}</button>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="state-empty">
            <b>{lang === 'kk' ? 'Ештеңе табылмады' : 'Ничего не найдено'}</b>
            <span>{lang === 'kk' ? 'Іздеуді өзгертіп көріңіз' : 'Измените запрос или выберите категорию'}</span>
          </div>
        ) : (
          <div className="tiles">
            {items.map((p) => {
              const b = tileBadge(p);
              return (
                <button key={p.productId} className={`tile ${b.kind === 'stop' ? 'tile-stop' : ''}`}
                  disabled={b.kind === 'stop'} onClick={() => props.onAdd(p)}>
                  {b.kind && (
                    <span className={`badge badge-${b.kind}`}>
                      {b.kind === 'stop' ? t('stop', lang) : b.text}
                    </span>
                  )}
                  <span className="tile-name">{p.name}</span>
                  <span className="tile-price money">{formatMoney(p.price)}</span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

// ═══════════════ ОПЛАТА ═══════════════

export type PayMethodKind = 'CASH' | 'CARD' | 'KASPI_QR' | 'MIXED';

export function PaymentScreen(props: {
  due: number;
  orderNumber?: number;
  tableName?: string;
  cashierName?: string;
  subtotal?: number;
  discountAmount?: number;
  drawerCash?: number;           // «В ящике сейчас» — из макета
  fiscal?: FiscalState;
  kaspiState?: 'idle' | 'waiting';
  lang?: Lang;
  onLang?: (l: Lang) => void;
  methods: { id: string; name: string; kind: PayMethodKind }[];
  onConfirm: (methodId: string, amount: number, tendered?: number) => void;
  onBack: () => void;
  onSplit?: () => void;
  onPrintCopy?: () => void;
  onManualPaid?: () => void;
  onRetryTerminal?: () => void;
}) {
  const lang = props.lang ?? 'ru';
  const [kind, setKind] = useState<PayMethodKind>(props.methods[0]?.kind ?? 'CASH');
  const [methodId, setMethodId] = useState(props.methods[0]?.id);
  const [tenderedTenge, setTendered] = useState(0);
  const vm: PaymentVm = { due: props.due, kind: kind === 'MIXED' ? 'CASH' : kind, tendered: tenderedTenge * 100 };
  const change = paymentChange(vm);
  const short = Math.max(0, props.due - vm.tendered);
  const quick = quickTenderOptions(props.due);
  const fb = fiscalBadge(props.fiscal ?? 'ok', 0, lang);

  const hintFor = (k: PayMethodKind) =>
    k === 'CASH' ? t('hintCash', lang) : k === 'KASPI_QR' ? t('hintKaspi', lang)
    : k === 'CARD' ? t('hintCard', lang) : t('hintMixed', lang);

  return (
    <div className="pay-screen">
      <header className="pay-top">
        <div className="pay-ctx">
          <button className="btn pay-back" style={{ minHeight: 40 }} onClick={props.onBack}>
            ← {t('back' in T ? 'order' : 'order', lang)}
          </button>
          {props.orderNumber != null && <span>№{props.orderNumber}</span>}
          {props.tableName && <span>· {t('table', lang)} {props.tableName}</span>}
        </div>
        <div className="ch-badges">
          <span className={fb.cls}>{fb.text}</span>
          {props.cashierName && <span className="pay-cashier">{props.cashierName} · {t('cashier', lang)}</span>}
          {props.onLang && <LangToggle lang={lang} onChange={props.onLang} />}
        </div>
      </header>

      {/* состав чека и разбивка — из макета */}
      {props.subtotal != null && (
        <section>
          <div className="label-mono">{t('check', lang)}</div>
          <div className="pay-breakdown">
            <div><span>{t('subtotal', lang)}</span><span className="money">{formatMoney(props.subtotal)}</span></div>
            {!!props.discountAmount && (
              <div><span>{t('discount', lang)}</span>
                <span className="pb-discount">−{formatMoney(props.discountAmount)}</span></div>
            )}
          </div>
        </section>
      )}

      <header className="pay-due">
        <span>{t('toPay', lang)}</span>
        <b className="money">{formatMoney(props.due)}</b>
      </header>

      <div className="pay-methods">
        {props.methods.map((m) => (
          <button key={m.id} className={`btn method ${methodId === m.id ? 'on' : ''}`}
            onClick={() => { setMethodId(m.id); setKind(m.kind); }}>
            <span>{m.name}<em style={{ display: 'block', fontSize: 12, fontStyle: 'normal', opacity: .7 }}>
              {hintFor(m.kind)}</em></span>
          </button>
        ))}
      </div>

      {kind === 'CASH' && (
        <section className="cash-pane">
          <div className="label-mono">{t('smartBills', lang)}</div>
          <div className="quick-notes">
            {quick.map((v, i) => (
              <button key={v} className="btn note" onClick={() => setTendered(v / 100)}>
                {i === 0 ? t('noChange', lang) : formatMoney(v)}
              </button>
            ))}
          </div>
          <div className="label-mono">{t('received', lang)}</div>
          <div className="tendered money">{formatMoney(vm.tendered)}</div>
          <div className="numpad">
            {['1','2','3','4','5','6','7','8','9','C','0','del'].map((k) => (
              <button key={k} className="btn numpad-key"
                onClick={() => setTendered(tenderPress(tenderedTenge, k))}>
                {k === 'del' ? '⌫' : k}
              </button>
            ))}
          </div>
          {short > 0 ? (
            <div className="change">
              <span>{t('notEnough', lang)}</span>
              <b className="money" style={{ color: 'var(--danger)' }}>{formatMoney(short)}</b>
            </div>
          ) : (
            <div className="change">
              <span>{t('change', lang)}</span>
              <b className="money">{formatMoney(change)}</b>
            </div>
          )}
          <p className="hint">{vm.tendered >= props.due ? t('changeHintReady', lang) : t('changeHintNeed', lang)}</p>
          {props.drawerCash != null && (
            <div className="pay-breakdown">
              <div><span>{t('inDrawer', lang)}</span>
                <span className="money">{formatMoney(props.drawerCash)}</span></div>
            </div>
          )}
        </section>
      )}

      {kind === 'KASPI_QR' && (
        <section className="card-pane">
          <div style={{ textAlign: 'center' }}>
            <b style={{ fontSize: 19 }}>{props.kaspiState === 'waiting' ? t('waiting', lang) : t('showQr', lang)}</b>
            <p className="hint">{props.kaspiState === 'waiting' ? t('waitingHint', lang) : t('qrHint', lang)}</p>
            {props.onManualPaid && (
              <button className="pay-extra-btn" style={{ marginTop: 14 }} onClick={props.onManualPaid}>
                {t('paidManually', lang)}
              </button>
            )}
          </div>
        </section>
      )}

      {kind === 'CARD' && (
        <section className="card-pane">
          <div style={{ textAlign: 'center' }}>
            <b style={{ fontSize: 19 }}>{t('cardT', lang)}</b>
            <p className="hint">{t('cardD', lang)}</p>
            {props.onRetryTerminal && (
              <button className="pay-extra-btn" style={{ marginTop: 14 }} onClick={props.onRetryTerminal}>
                {t('cardA', lang)}
              </button>
            )}
          </div>
        </section>
      )}

      {kind === 'MIXED' && (
        <section className="cash-pane">
          <div className="label-mono">{t('mixedT', lang)}</div>
          <div className="pay-breakdown">
            <div><span>{t('left', lang)}</span><span className="money">{formatMoney(props.due)}</span></div>
          </div>
          <p className="hint">{t('hintMixed', lang)}</p>
        </section>
      )}

      <div className="pay-extra">
        {props.onSplit && (
          <button className="pay-extra-btn" onClick={props.onSplit}>{t('split', lang)}</button>
        )}
        {props.onPrintCopy && (
          <button className="pay-extra-btn" onClick={props.onPrintCopy}>{t('printCopy', lang)}</button>
        )}
      </div>

      <footer className="pay-actions">
        <button className="btn" onClick={props.onBack}>{t('order', lang)}</button>
        <button className="btn btn-ok" disabled={!paymentValid(vm)}
          onClick={() => props.onConfirm(methodId!, props.due, kind === 'CASH' ? vm.tendered : undefined)}>
          {t('punch', lang)}
        </button>
      </footer>
    </div>
  );
}

// ═══════════════ ДЕЙСТВИЯ С ПОЗИЦИЕЙ ═══════════════
// Контекстное меню по долгому нажатию вместо кнопок на экране.
// Кнопки заняли бы место, которое нужнее плиткам меню,
// а долгое нажатие кассир осваивает за одну смену.

export function ItemActions(props: {
  item: { id: string; name: string; qty: number; comment?: string | null; sentAt?: string | null };
  openOrders: { orderId: string; number: number; tableName: string }[];
  onComment: (text: string) => void;
  onMove: (toOrderId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'comment' | 'move'>('menu');
  const [text, setText] = useState(props.item.comment ?? '');
  const sent = !!props.item.sentAt;

  // Частые комментарии кнопками: набирать «без лука» на сенсорном
  // экране в час пик — потерянные секунды на каждом заказе
  const QUICK = ['без лука', 'без соли', 'острое', 'не острое', 'отдельно', 'с собой'];

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <b>{props.item.name}</b>
          <span>×{props.item.qty}</span>
        </header>

        {mode === 'menu' && (
          <div className="sheet-actions">
            <button className="sheet-btn" disabled={sent}
              onClick={() => setMode('comment')}>
              Комментарий
              {sent && <em>уже на кухне</em>}
            </button>
            <button className="sheet-btn" onClick={() => setMode('move')}>
              Перенести на другой стол
            </button>
            <button className="sheet-btn danger" onClick={props.onRemove}>
              Удалить позицию
            </button>
          </div>
        )}

        {mode === 'comment' && (
          <div className="sheet-body">
            <div className="quick-tags">
              {QUICK.map((q) => (
                <button key={q} className="quick-tag"
                  onClick={() => setText(text ? `${text}, ${q}` : q)}>
                  {q}
                </button>
              ))}
            </div>
            <input className="sheet-input" value={text} autoFocus
              placeholder="Что сказать повару"
              onChange={(e) => setText(e.target.value)} />
            <div className="sheet-foot">
              <button className="btn" onClick={() => setMode('menu')}>Назад</button>
              <button className="btn btn-accent" onClick={() => props.onComment(text)}>
                Сохранить
              </button>
            </div>
          </div>
        )}

        {mode === 'move' && (
          <div className="sheet-body">
            {!props.openOrders.length && (
              <p className="hint">Других открытых столов нет</p>
            )}
            <div className="move-list">
              {props.openOrders.map((o) => (
                <button key={o.orderId} className="move-row"
                  onClick={() => props.onMove(o.orderId)}>
                  <b>{o.tableName}</b>
                  <span>заказ №{o.number}</span>
                </button>
              ))}
            </div>
            <div className="sheet-foot">
              <button className="btn" onClick={() => setMode('menu')}>Назад</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

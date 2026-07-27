// apps/pos/src/ui/screens/PosScreens.tsx
// Три главных экрана кассы. Макет — из анализа скриншотов:
//  QuickResto: чек слева, плитки с фото справа, категории лентой
//  Paloma: оплата — сумма/получено/сдача крупно, быстрые купюры
//  Poster: минимализм и скорость (≤6 касаний — контролируется TAP_BUDGET)
import React, { useMemo, useState } from 'react';
import {
  PinVm, pinPress, pinReady, CatalogItem, filterCatalog, tileBadge,
  PaymentVm, paymentChange, paymentValid, quickTenderOptions, tenderPress,
  formatMoney, syncStatusLabel,
} from './vm.ts';
import { OrderState, orderTotals } from './order.ts';

// ═══════════════ PIN ═══════════════
export function PinScreen({ onSubmit }: { onSubmit: (pin: string) => Promise<boolean> }) {
  const [vm, setVm] = useState<PinVm>({ digits: '' });
  const press = async (k: string) => {
    const next = pinPress(vm, k);
    setVm(next);
    if (k !== 'del' && pinReady(next) && next.digits.length === 4) {
      const ok = await onSubmit(next.digits);
      if (!ok) setVm({ digits: '', error: 'Неверный PIN' });
    }
  };
  return (
    <div className="pin-screen">
      <div className="pin-dots">{'●'.repeat(vm.digits.length).padEnd(4, '○')}</div>
      {vm.error && <div className="pin-error">{vm.error}</div>}
      <div className="numpad">
        {['1','2','3','4','5','6','7','8','9','','0','del'].map((k) => (
          <button key={k} className="btn numpad-key" disabled={!k}
            onClick={() => press(k)}>{k === 'del' ? '⌫' : k}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════ ЗАКАЗ (главный экран) ═══════════════
export function OrderScreen(props: {
  order: OrderState;
  catalog: CatalogItem[];
  categories: { id: string; name: string; color?: string }[];
  online: boolean; unsyncedCount: number;
  onAdd: (p: CatalogItem) => void;
  onPay: () => void;
  onItemTap: (itemId: string) => void; // меню позиции: qty/гость/удалить(PIN)
}) {
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const items = useMemo(() => filterCatalog(props.catalog, cat, q), [props.catalog, cat, q]);
  const totals = orderTotals(props.order);
  const sync = syncStatusLabel(props.online, props.unsyncedCount);

  return (
    <div className="order-screen"> {/* grid: чек 38% | каталог 62% */}
      <aside className="check-pane">
        <header className="check-head">
          <span>Заказ №{props.order.number}</span>
          <span className={`sync sync-${sync.tone}`}>{sync.text}</span>
        </header>
        <ul className="check-items">
          {props.order.items.filter((i) => !i.isRemoved).map((i) => (
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
        <footer className="check-foot">
          <div className="check-total money" style={{ fontSize: 'var(--money-size)' }}>
            {formatMoney(totals.subtotal)}
          </div>
          <button className="btn btn-ok pay-btn" disabled={!totals.itemsCount}
            onClick={props.onPay}>Оплата</button>
        </footer>
      </aside>

      <main className="catalog-pane">
        <div className="catalog-top">
          <input className="search" placeholder="Поиск…" value={q}
            onChange={(e) => setQ(e.target.value)} />
          <div className="cat-strip">
            <button className={`cat ${cat === null ? 'on' : ''}`} onClick={() => setCat(null)}>Все</button>
            {props.categories.map((c) => (
              <button key={c.id} className={`cat ${cat === c.id ? 'on' : ''}`}
                style={{ borderColor: c.color }} onClick={() => setCat(c.id)}>{c.name}</button>
            ))}
          </div>
        </div>
        <div className="tiles">
          {items.map((p) => {
            const b = tileBadge(p);
            return (
              <button key={p.productId} className={`tile ${b.kind === 'stop' ? 'tile-stop' : ''}`}
                disabled={b.kind === 'stop'} onClick={() => props.onAdd(p)}>
                {b.kind && <span className={`badge badge-${b.kind}`}>{b.text}</span>}
                <span className="tile-name">{p.name}</span>
                <span className="tile-price money">{formatMoney(p.price)}</span>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

// ═══════════════ ОПЛАТА ═══════════════
export function PaymentScreen(props: {
  due: number;
  methods: { id: string; name: string; kind: PaymentVm['kind'] }[];
  onConfirm: (methodId: string, amount: number, tendered?: number) => void;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<PaymentVm['kind']>('CASH');
  const [methodId, setMethodId] = useState(props.methods[0]?.id);
  const [tenderedTenge, setTendered] = useState(0);
  const vm: PaymentVm = { due: props.due, kind, tendered: tenderedTenge * 100 };
  const change = paymentChange(vm);
  const quick = quickTenderOptions(props.due);

  return (
    <div className="pay-screen">
      <header className="pay-due">
        <span>К оплате</span>
        <b className="money" style={{ fontSize: 'var(--money-size-xl)' }}>{formatMoney(props.due)}</b>
      </header>

      <div className="pay-methods">
        {props.methods.map((m) => (
          <button key={m.id} className={`btn method ${methodId === m.id ? 'on' : ''}`}
            onClick={() => { setMethodId(m.id); setKind(m.kind); }}>{m.name}</button>
        ))}
      </div>

      {kind === 'CASH' && (
        <section className="cash-pane">
          <div className="quick-notes">
            {quick.map((v, i) => (
              <button key={v} className="btn note" onClick={() => setTendered(v / 100)}>
                {i === 0 ? 'Без сдачи' : formatMoney(v)}
              </button>
            ))}
          </div>
          <div className="tendered money">{formatMoney(vm.tendered)}</div>
          <div className="numpad">
            {['1','2','3','4','5','6','7','8','9','C','0','del'].map((k) => (
              <button key={k} className="btn numpad-key"
                onClick={() => setTendered(tenderPress(tenderedTenge, k))}>
                {k === 'del' ? '⌫' : k}
              </button>
            ))}
          </div>
          <div className="change">
            <span>Сдача</span>
            <b className="money" style={{ fontSize: 'var(--money-size-xl)' }}>{formatMoney(change)}</b>
          </div>
        </section>
      )}
      {kind !== 'CASH' && (
        <section className="card-pane">
          <p className="hint">
            {kind === 'CARD' ? 'Сумма уйдёт на терминал автоматически' : 'Покажите QR гостю'}
          </p>
        </section>
      )}

      <footer className="pay-actions">
        <button className="btn" onClick={props.onBack}>Назад</button>
        <button className="btn btn-ok" disabled={!paymentValid(vm)}
          onClick={() => props.onConfirm(methodId!, props.due, kind === 'CASH' ? vm.tendered : undefined)}>
          Готово
        </button>
      </footer>
    </div>
  );
}

// apps/api/src/integrations/kz.integrations.ts
// Три казахстанские интеграции. Протоколы — из документации Paloma
// (kaspiqr: API AUTHKEY; wolt: Venue ID + API key + вебхук; rekassa) и
// открытых API. Всё как чистые функции + драйверы с injected fetch.

import { FiscalDriver, FiscalRequest, FiscalResult } from '../payments.logic';

export type Money = number;

// ═══════════════ KASPI QR (удалённая оплата) ═══════════════
// Флоу: создать платёж → получить QR/ссылку → гость платит в приложении →
// поллинг статуса (или вебхук) → CAPTURED. Paloma: настройка через AUTHKEY.

export type KaspiQrStatus = 'CREATED' | 'SCANNED' | 'PROCESSED' | 'ERROR' | 'EXPIRED';

export interface KaspiQrSession {
  paymentId: string;
  amount: Money;
  status: KaspiQrStatus;
  qrUrl?: string;
  createdAt: number;   // epoch ms
  ttlMs: number;       // время жизни QR (обычно 5 минут)
}

export function kaspiQrCreate(paymentId: string, amount: Money, now: number, ttlMs = 5 * 60_000): KaspiQrSession {
  if (amount <= 0) throw new Error('BAD_AMOUNT');
  return { paymentId, amount, status: 'CREATED', createdAt: now, ttlMs };
}

/** Переходы статусов + истечение по TTL (грабля: гость ушёл, QR висит). */
export function kaspiQrAdvance(s: KaspiQrSession, ev: { type: 'scanned' | 'processed' | 'error' } | { type: 'tick'; now: number }): KaspiQrSession {
  if (s.status === 'PROCESSED' || s.status === 'ERROR' || s.status === 'EXPIRED') return s;
  if (ev.type === 'tick') {
    return ev.now - s.createdAt > s.ttlMs ? { ...s, status: 'EXPIRED' } : s;
  }
  if (ev.type === 'scanned') return s.status === 'CREATED' ? { ...s, status: 'SCANNED' } : s;
  if (ev.type === 'processed') return { ...s, status: 'PROCESSED' };
  return { ...s, status: 'ERROR' };
}

/** Интервал поллинга: часто в первые 30с (гость сканирует), реже потом. */
export function kaspiQrPollDelay(elapsedMs: number): number {
  return elapsedMs < 30_000 ? 2_000 : 5_000;
}

// ═══════════════ re:Kassa (второй фискальный провайдер) ═══════════════
// Открытый API (api.rekassa.kz): касса привязана по номеру, авторизация
// токеном, чек = операция с позициями и оплатами. Тот же интерфейс
// FiscalDriver, что Webkassa (Этап 3) — провайдеры взаимозаменяемы.

const RK_PAY = { CASH: 'PAYMENT_CASH', CARD: 'PAYMENT_CARD', KASPI_QR: 'PAYMENT_CARD', TRANSFER: 'PAYMENT_OTHER', BONUS: 'PAYMENT_OTHER' } as const;

export class ReKassaDriver implements FiscalDriver {
  type = 'rekassa';
  constructor(
    private cfg: { baseUrl: string; cashboxNumber: string; token: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(req: FiscalRequest): Promise<FiscalResult> {
    try {
      const body = {
        operation: req.op === 'SELL' ? 'OPERATION_SELL' : 'OPERATION_SELL_RETURN',
        items: req.items.map((i) => ({
          type: 'ITEM_TYPE_COMMODITY',
          commodity: {
            name: i.name,
            quantity: Math.round(i.qty * 1000), // re:Kassa: quantity ×1000
            price: { bills: Math.trunc(i.price / 100), coins: i.price % 100 },
            taxes: i.vatRate > 0 ? [{ percent: i.vatRate * 1000, sum: taxSum(i.price, i.qty, i.vatRate) }] : [],
          },
        })),
        payments: req.payments.map((p) => ({
          type: RK_PAY[p.kind] ?? 'PAYMENT_OTHER',
          sum: { bills: Math.trunc(p.amount / 100), coins: p.amount % 100 },
        })),
      };
      const r = await this.fetchImpl(
        `${this.cfg.baseUrl}/api/crs/${this.cfg.cashboxNumber}/tickets`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.token}` }, body: JSON.stringify(body) },
      );
      if (r.status === 401) return { success: false, errorCode: 'AUTH', retriable: true };
      if (!r.ok) return { success: false, errorCode: `HTTP_${r.status}`, retriable: r.status >= 500 };
      const data = await r.json();
      return { success: true, fiscalNumber: data?.id, ofdUrl: data?.ticketUrl };
    } catch (e: any) {
      return { success: false, errorCode: 'NETWORK', errorText: e?.message, retriable: true };
    }
  }
}

function taxSum(priceT: Money, qty: number, vatPct: number): { bills: number; coins: number } {
  // НДС «в том числе»: sum = total × rate/(100+rate)
  const total = priceT * qty;
  const tax = Math.round((total * vatPct) / (100 + vatPct));
  return { bills: Math.trunc(tax / 100), coins: tax % 100 };
}

// ═══════════════ WOLT (агрегатор) ═══════════════
// Протокол из доков Paloma: Wolt шлёт заказ на наш вебхук; нам нужны
// Venue ID + API key. Мы: вебхук → наш DeliveryInfo(NEW), меню-синк и
// стоп-лист → Wolt API.

export interface WoltWebhookOrder {
  id: string;
  venue: { id: string };
  items: { name: string; count: number; base_price: number; pos_id?: string }[];
  consumer_comment?: string;
  consumer_phone_number?: string;
  delivery?: { location?: { formatted_address?: string } };
  pre_order?: { preorder_time?: string };
  price: { amount: number; currency: string };
}

export interface OurDeliveryDraft {
  source: 'wolt';
  externalId: string;
  phone: string;
  address: string;
  comment?: string;
  scheduledAt?: string;
  lines: { productId: string | null; rawName: string; qty: number; unitPrice: Money }[];
  total: Money;
}

/** Маппинг вебхука Wolt → наш черновик доставки. pos_id = наш productId
 *  (проставляется при выгрузке меню в Wolt); нет pos_id → матчинг ИИ (Этап 8). */
export function mapWoltOrder(w: WoltWebhookOrder): OurDeliveryDraft {
  return {
    source: 'wolt',
    externalId: w.id,
    phone: w.consumer_phone_number ?? '',
    address: w.delivery?.location?.formatted_address ?? 'Самовывоз Wolt',
    comment: w.consumer_comment,
    scheduledAt: w.pre_order?.preorder_time,
    lines: w.items.map((i) => ({
      productId: i.pos_id ?? null,
      rawName: i.name,
      qty: i.count,
      unitPrice: i.base_price, // Wolt отдаёт в минорных единицах
    })),
    total: w.price.amount,
  };
}

/** Выгрузка нашего меню в формат Wolt (pos_id = наш productId — ключ маппинга). */
export function mapMenuToWolt(items: { productId: string; name: string; price: Money; imageUrl?: string }[]) {
  return items.map((i) => ({
    pos_id: i.productId,
    name: i.name,
    price: i.price,
    image_url: i.imageUrl,
    enabled: true,
  }));
}

/** Стоп-лист → Wolt: погашенные позиции. */
export function stopListToWolt(stopped: string[]): { pos_id: string; enabled: false }[] {
  return stopped.map((pos_id) => ({ pos_id, enabled: false }));
}

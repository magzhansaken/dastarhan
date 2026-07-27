// apps/api/src/payments/fiscal/webkassa.driver.ts
// Драйвер Webkassa — облачная фискализация КЗ (главный провайдер: им пользуются
// Poster и Paloma; чек печатается на обычном ESC/POS-принтере, фискальный
// регистратор не нужен — это снимает самое дорогое железо у клиента).
// Модель API (из документации Paloma webkassa 13K + публичной Webkassa):
//  auth: POST /api/Authorize {Login, Password} → Token (живёт ~24ч)
//  чек:  POST /api/Check {Token, CashboxUniqueNumber, OperationType, Positions[], Payments[]}
//  возврат: OperationType=Return; Z-отчёт: /api/ZReport
// Все суммы Webkassa принимает в ТЕНГЕ с копейками → конвертируем из тиынов.

import { FiscalDriver, FiscalRequest, FiscalResult } from '../payments.logic';

const OP = { SELL: 2, REFUND: 3 } as const;            // коды операций Webkassa
const PAY = { CASH: 0, CARD: 1, KASPI_QR: 4, TRANSFER: 4, BONUS: 4 } as const;

export class WebkassaDriver implements FiscalDriver {
  type = 'webkassa';
  private token: string | null = null;
  private tokenAt = 0;

  constructor(
    private cfg: { baseUrl: string; login: string; password: string; cashboxNumber: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async auth(): Promise<string> {
    // токен кэшируем 20ч; перевыпуск при 401
    if (this.token && Date.now() - this.tokenAt < 20 * 3600_000) return this.token;
    const r = await this.fetchImpl(`${this.cfg.baseUrl}/api/Authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Login: this.cfg.login, Password: this.cfg.password }),
    });
    if (!r.ok) throw Object.assign(new Error(`Webkassa auth HTTP ${r.status}`), { retriable: true });
    const data = await r.json();
    const token = data?.Data?.Token;
    if (!token) throw Object.assign(new Error('Webkassa: нет токена в ответе'), { retriable: true });
    this.token = token; this.tokenAt = Date.now();
    return token;
  }

  async send(req: FiscalRequest): Promise<FiscalResult> {
    try {
      const token = await this.auth();
      const body = {
        Token: token,
        CashboxUniqueNumber: this.cfg.cashboxNumber,
        OperationType: OP[req.op],
        Positions: req.items.map((i) => ({
          Count: i.qty,
          Price: i.price / 100,          // тиыны → тенге
          PositionName: i.name,
          Tax: i.vatRate,                // 16 | 0
          TaxType: 100,                  // НДС в сумме
        })),
        Payments: req.payments.map((p) => ({
          Sum: p.amount / 100,
          PaymentType: PAY[p.kind] ?? 4,
        })),
      };
      const r = await this.fetchImpl(`${this.cfg.baseUrl}/api/Check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 401) { this.token = null; return { success: false, errorCode: 'AUTH', errorText: 'Токен истёк', retriable: true }; }
      if (!r.ok) return { success: false, errorCode: `HTTP_${r.status}`, errorText: 'Ошибка Webkassa', retriable: r.status >= 500 };
      const data = await r.json();
      if (data?.Errors?.length) {
        const e = data.Errors[0];
        // Коды 4xx-логики Webkassa (например, «смена превысила 24ч») — не ретраим,
        // показываем кассиру (Paloma отдельно предупреждает про длину смены!)
        return { success: false, errorCode: String(e.Code), errorText: e.Text, retriable: false };
      }
      return {
        success: true,
        fiscalNumber: data?.Data?.CheckNumber,
        ofdUrl: data?.Data?.TicketUrl,   // ссылка на чек ОФД (QR для гостя)
      };
    } catch (e: any) {
      return { success: false, errorCode: 'NETWORK', errorText: e?.message ?? 'Сеть', retriable: e?.retriable ?? true };
    }
  }
}

/** NoOp — «без фискализации» (ИП на спецрежимах/тест): чек пропускается. */
export class NoopFiscalDriver implements FiscalDriver {
  type = 'noop';
  async send(): Promise<FiscalResult> { return { success: true, fiscalNumber: 'NOOP' }; }
}

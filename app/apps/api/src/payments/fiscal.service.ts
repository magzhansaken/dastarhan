// apps/api/src/payments/fiscal.service.ts
// Фискализация чеков через Webkassa или re:Kassa.
//
// Главный принцип: чек НИКОГДА не теряется. Продажа уже состоялась,
// деньги у кассира — значит фискальный чек обязан уйти, пусть и позже.
// Поэтому запись в очередь создаётся ДО обращения к провайдеру,
// а неудача переводит её в ретрай, а не отменяет продажу.
//
// Разделение ошибок принципиальное:
//   · сеть, таймаут, 5xx → повторяем с нарастающей паузой
//   · неверные данные, нет кассы в ОФД → повтор бессмыслен, зовём человека
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { WebkassaDriver, NoopFiscalDriver } from './fiscal/webkassa.driver';
import type { FiscalDriver, FiscalRequest } from './payments.logic';

/** Паузы между попытками: быстро, потом реже — чтобы не долбить упавший ОФД. */
const RETRY_MINUTES = [1, 5, 15, 60, 180];

@Injectable()
export class FiscalService {
  private readonly log = new Logger('Fiscal');
  private driver: FiscalDriver;

  constructor(private prisma: PrismaService) {
    const login = process.env.WEBKASSA_LOGIN;
    const password = process.env.WEBKASSA_PASSWORD;
    const cashbox = process.env.WEBKASSA_CASHBOX;

    if (login && password && cashbox) {
      this.driver = new WebkassaDriver({
        baseUrl: process.env.WEBKASSA_API_URL ?? 'https://devkkm.webkassa.kz/api',
        login, password, cashboxNumber: cashbox,
      });
      this.log.log(`Webkassa подключена: касса ${cashbox}`);
    } else {
      // Без ключей работаем в режиме заглушки: чеки копятся в очереди
      // со статусом SKIPPED и уйдут, когда ключи появятся
      this.driver = new NoopFiscalDriver();
      this.log.warn('Webkassa не настроена — чеки не фискализируются');
    }
  }

  get isConfigured(): boolean {
    return this.driver.type !== 'noop';
  }

  /**
   * Поставить чек в очередь фискализации и попытаться отправить сразу.
   * Возвращает результат первой попытки, но чек остаётся в очереди
   * при любой ошибке — касса не должна ждать ОФД.
   */
  async enqueue(params: {
    accountId: string;
    orderId: string;
    request: FiscalRequest;
  }) {
    const existing = await this.prisma.fiscalReceipt.findFirst({
      where: { orderId: params.orderId, op: 'SELL' },
    });
    if (existing) return { status: existing.status, receiptId: existing.id };

    const receipt = await this.prisma.fiscalReceipt.create({
      data: {
        accountId: params.accountId,
        orderId: params.orderId,
        op: 'SELL',
        providerId: this.driver.type,
        payload: params.request as any,
        status: 'QUEUED',
        attempts: 0,
      },
    });

    if (!this.isConfigured) {
      // Ключей нет — чек ждёт настройки, но продажа не блокируется
      return { status: 'QUEUED', receiptId: receipt.id, note: 'Webkassa не настроена' };
    }

    const r = await this.attempt(receipt.id);
    return { status: r, receiptId: receipt.id };
  }

  /** Одна попытка отправки. Обновляет статус и планирует следующую при неудаче. */
  async attempt(receiptId: string): Promise<'SENT' | 'QUEUED' | 'ERROR'> {
    const rec = await this.prisma.fiscalReceipt.findUnique({ where: { id: receiptId } });
    if (!rec || rec.status === 'SENT') return 'SENT';

    try {
      const res = await this.driver.send(rec.payload as any);

      if (res.success) {
        await this.prisma.fiscalReceipt.update({
          where: { id: rec.id },
          data: {
            status: 'SENT',
            fiscalNumber: res.fiscalNumber ?? null,
            ofdUrl: res.ofdUrl ?? null,
            sentAt: new Date(),
            attempts: rec.attempts + 1,
            error: null,
            nextTryAt: null,
          },
        });
        this.log.log(`Чек ${rec.orderId} фискализирован: ${res.fiscalNumber}`);
        return 'SENT';
      }

      // Логическая ошибка: повтор ничего не изменит, нужен человек
      if (res.retriable === false) {
        await this.prisma.fiscalReceipt.update({
          where: { id: rec.id },
          data: {
            status: 'ERROR',
            attempts: rec.attempts + 1,
            error: `${res.errorCode ?? ''} ${res.errorText ?? ''}`.trim(),
            nextTryAt: null,
          },
        });
        this.log.error(`Чек ${rec.orderId}: ${res.errorText}`);
        return 'ERROR';
      }

      // Временная ошибка: планируем следующую попытку
      const idx = Math.min(rec.attempts, RETRY_MINUTES.length - 1);
      const next = new Date(Date.now() + RETRY_MINUTES[idx] * 60_000);
      await this.prisma.fiscalReceipt.update({
        where: { id: rec.id },
        data: {
          status: 'QUEUED',
          attempts: rec.attempts + 1,
          error: res.errorText ?? 'нет ответа',
          nextTryAt: next,
        },
      });
      return 'QUEUED';
    } catch (e: any) {
      const idx = Math.min(rec.attempts, RETRY_MINUTES.length - 1);
      await this.prisma.fiscalReceipt.update({
        where: { id: rec.id },
        data: {
          status: 'QUEUED',
          attempts: rec.attempts + 1,
          error: e?.message ?? 'сеть недоступна',
          nextTryAt: new Date(Date.now() + RETRY_MINUTES[idx] * 60_000),
        },
      });
      return 'QUEUED';
    }
  }

  /** Обработка очереди: чеки, которым пора на повтор. */
  async processQueue(limit = 50) {
    if (!this.isConfigured) return { processed: 0, sent: 0, note: 'Webkassa не настроена' };

    const due = await this.prisma.fiscalReceipt.findMany({
      where: {
        status: 'QUEUED',
        OR: [{ nextTryAt: null }, { nextTryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let sent = 0;
    for (const r of due) {
      if ((await this.attempt(r.id)) === 'SENT') sent++;
    }
    return { processed: due.length, sent };
  }

  /** Сводка для кассы и супер-админки: сколько чеков ждёт ОФД. */
  async status(accountId: string) {
    const [queued, errors, sentToday] = await Promise.all([
      this.prisma.fiscalReceipt.count({ where: { accountId, status: 'QUEUED' } }),
      this.prisma.fiscalReceipt.count({ where: { accountId, status: 'ERROR' } }),
      this.prisma.fiscalReceipt.count({
        where: {
          accountId, status: 'SENT',
          sentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      configured: this.isConfigured,
      provider: this.driver.type,
      queued, errors, sentToday,
      // Кассиру важна не техника, а ответ на вопрос «всё ли в порядке»
      ok: errors === 0 && queued < 10,
    };
  }
}

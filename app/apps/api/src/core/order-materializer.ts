// apps/api/src/core/order-materializer.ts
// Превращает событие «чек закрыт» с кассы в настоящие записи БД:
// заказ, позиции, платёж. До этого чек живёт как событие в EventLog —
// это гарантирует, что продажа не потеряется, даже если разбор упадёт.
//
// Порядок важен: сначала сохраняем факт (событие), потом интерпретируем.
// Если интерпретация сломается, данные останутся и разберутся позже.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type PayKind = 'CASH' | 'CARD' | 'KASPI_QR' | 'BONUS' | 'TRANSFER';

@Injectable()
export class OrderMaterializer {
  private readonly log = new Logger('Materializer');

  constructor(private prisma: PrismaService) {}

  /** Способ оплаты с кассы → тип платежа в БД. */
  private payKind(methodId: string): PayKind {
    const m = (methodId ?? '').toLowerCase();
    if (m.includes('kaspi')) return 'KASPI_QR';
    if (m.includes('card') || m.includes('терминал')) return 'CARD';
    if (m.includes('bonus')) return 'BONUS';
    return 'CASH';
  }

  /**
   * Открытая смена терминала. Если её нет — открываем автоматически.
   * Кассир не должен упереться в «сначала откройте смену» посреди продажи:
   * лучше открыть за него и показать это в отчёте, чем потерять чек.
   */
  private async ensureShift(accountId: string, locationId: string, terminalId: string, userId: string) {
    const open = await this.prisma.cashShift.findFirst({
      where: { terminalId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (open) return open;

    const last = await this.prisma.cashShift.findFirst({
      where: { terminalId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    return this.prisma.cashShift.create({
      data: {
        accountId, locationId, terminalId,
        number: (last?.number ?? 0) + 1,
        openedBy: userId || 'system',
        openingCash: 0,
        note: 'Открыта автоматически при первой продаже',
      },
    });
  }

  /** Разбор одного события order.closed. Идемпотентен по orderId. */
  async materialize(ev: {
    terminalId: string;
    payload: any;
  }): Promise<'created' | 'skipped' | 'error'> {
    const p = ev.payload ?? {};
    if (!p.orderId || !Array.isArray(p.items)) {
      this.log.warn(`Пропуск: нет orderId или items (orderId=${p.orderId})`);
      return 'skipped';
    }

    try {
      // Повторный разбор того же чека недопустим — задвоит выручку
      const exists = await this.prisma.order.findUnique({ where: { id: p.orderId } });
      if (exists) {
        this.log.log(`Пропуск: заказ ${p.orderId} уже проведён`);
        return 'skipped';
      }

      const terminal = await this.prisma.terminal.findUnique({
        where: { id: ev.terminalId },
        include: { location: true },
      });
      if (!terminal) {
        this.log.warn(`Пропуск: терминал ${ev.terminalId} не найден`);
        return 'skipped';
      }
      this.log.log(`Разбираю чек №${p.number}, терминал ${terminal.name}`);

      const accountId = terminal.location.accountId;
      const shift = await this.ensureShift(
        accountId, terminal.locationId, terminal.id, p.cashierId ?? '',
      );

      const total = Number(p.total ?? 0);
      const closedAt = p.closedAt ? new Date(p.closedAt) : new Date();

      await this.prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            id: p.orderId,
            accountId,
            locationId: terminal.locationId,
            terminalId: terminal.id,
            shiftId: shift.id,
            number: Number(p.number ?? 0),
            mode: 'DINE_IN',
            status: 'CLOSED',
            guestsCount: 1,
            waiterId: p.cashierId ?? null,
            openedAt: closedAt,
            closedAt,
            subtotal: total,
            discount: 0,
            total,
            items: {
              create: p.items.map((i: any) => ({
                productId: i.productId,
                // Имя фиксируем на момент продажи: меню меняется,
                // а в чеке должно остаться то, что купил гость
                nameSnapshot: i.name ?? '—',
                guestNo: 1,
                qty: Number(i.qty ?? 1),
                unitPrice: Number(i.unitPrice ?? 0),
                modifiers: [],
              })),
            },
          },
        });

        await tx.payment.create({
          data: {
            orderId: p.orderId,
            methodId: p.methodId ?? 'cash',
            kind: this.payKind(p.methodId) as any,
            amount: Number(p.amount ?? total),
            status: 'CAPTURED',
            capturedAt: closedAt,
          },
        });
      });

      this.log.log(`Чек №${p.number} на ${Math.trunc(total / 100)} ₸ проведён`);
      return 'created';
    } catch (e: any) {
      this.log.error(`Чек ${p.orderId} не разобран: ${e?.message}`);
      return 'error';
    }
  }
}

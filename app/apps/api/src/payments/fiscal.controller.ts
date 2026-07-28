// apps/api/src/payments/fiscal.controller.ts
// Состояние фискализации: касса показывает его в шапке, супер-админка —
// в списке клиентов. Кассиру важен не технический статус, а ответ
// на вопрос «чеки уходят или нет».
import {
  Body, Controller, Get, Post, Query, UseGuards, Req,
  BadRequestException,
} from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PrismaService } from '../core/prisma.service';

@Controller('fiscal')
export class FiscalController {
  constructor(
    private fiscal: FiscalService,
    private prisma: PrismaService,
  ) {}

  /** Сводка для кассы: сколько чеков ждёт ОФД. */
  @Get('status')
  @UseGuards(JwtGuard)
  async status(@Req() req: any) {
    return this.fiscal.status(req.user.acc);
  }

  /**
   * Разбор очереди. Вызывается по расписанию (cron на сервере)
   * или вручную, когда связь с ОФД восстановилась.
   */
  @Post('process')
  async process() {
    return this.fiscal.processQueue();
  }

  /**
   * Сверка с банковским терминалом.
   *
   * Каждое утро сумма в системе расходится с итогом терминала,
   * и никто не знает почему. Обычные причины: чек пробили,
   * а оплату не провели; провели дважды; вернули на терминале,
   * но не в системе.
   *
   * Мы показываем не «расхождение 12 000», а список конкретных
   * чеков, которые к нему привели.
   */
  @Get('acquiring-reconcile')
  @UseGuards(JwtGuard)
  async acquiringReconcile(
    @Req() req: any,
    @Query('shiftId') shiftId?: string,
    @Query('terminalTotal') terminalTotal?: string,
  ) {
    const where = shiftId
      ? { order: { shiftId } }
      : { capturedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } };

    const payments = await this.prisma.payment.findMany({
      where: {
        ...where as any,
        kind: { in: ['CARD', 'KASPI_QR', 'KASPI_PAY'] },
      },
      include: {
        order: {
          select: { id: true, number: true, status: true, closedAt: true, total: true },
        },
      },
      orderBy: { capturedAt: 'asc' },
    });

    const captured = payments.filter((p) => p.status === 'CAPTURED');
    const systemTotal = captured.reduce((s, p) => s + p.amount, 0);
    const bank = terminalTotal ? Number(terminalTotal) : null;

    // Подозрительные операции — то, что чаще всего даёт расхождение
    const suspects = [];

    // Платёж есть, а заказ отменён: деньги списали, чек аннулировали
    for (const p of captured) {
      if (p.order?.status === 'CANCELLED') {
        suspects.push({
          kind: 'cancelled_paid',
          orderNumber: p.order.number,
          amount: p.amount,
          text: 'Заказ отменён, но оплата картой прошла — нужен возврат на терминале',
        });
      }
    }

    // Две оплаты на один заказ с одинаковой суммой — почти всегда
    // двойное списание: кассир нажал ещё раз, не увидев результат
    const byOrder = new Map<string, typeof captured>();
    for (const p of captured) {
      const arr = byOrder.get(p.orderId) ?? [];
      arr.push(p);
      byOrder.set(p.orderId, arr);
    }
    for (const [, list] of byOrder) {
      if (list.length < 2) continue;
      const sums = list.map((x) => x.amount);
      if (new Set(sums).size < sums.length) {
        suspects.push({
          kind: 'possible_double',
          orderNumber: list[0].order?.number ?? null,
          amount: sums[0],
          text: 'Две одинаковые оплаты на один заказ — проверьте двойное списание',
        });
      }
    }

    // Незавершённые: кассир начал оплату и не довёл
    const pending = payments.filter((p) => p.status === 'PENDING');
    for (const p of pending) {
      suspects.push({
        kind: 'pending',
        orderNumber: p.order?.number ?? null,
        amount: p.amount,
        text: 'Оплата зависла в обработке — проверьте на терминале, прошла ли',
      });
    }

    const diff = bank !== null ? bank - systemTotal : null;

    return {
      systemTotal,
      terminalTotal: bank,
      diff,
      operationsCount: captured.length,
      byKind: ['CARD', 'KASPI_QR', 'KASPI_PAY'].map((k) => ({
        kind: k,
        count: captured.filter((p) => p.kind === k).length,
        sum: captured.filter((p) => p.kind === k).reduce((s, p) => s + p.amount, 0),
      })).filter((x) => x.count > 0),
      suspects,
      // Вердикт словами: бухгалтер должен понять за секунду,
      // сходится или нет, и насколько это критично
      verdict: diff === null ? 'Введите итог с терминала для сверки'
        : diff === 0 ? 'Всё сошлось'
        : Math.abs(diff) < 10000
        ? `Расхождение ${Math.trunc(Math.abs(diff) / 100)} ₸ — в пределах округления`
        : diff > 0
        ? `Терминал показывает больше на ${Math.trunc(diff / 100)} ₸ — возможно, оплату не провели в системе`
        : `Система показывает больше на ${Math.trunc(-diff / 100)} ₸ — возможно, был возврат на терминале`,
    };
  }

  /**
   * Отмена оплаты картой. Возврат делается на терминале,
   * система только фиксирует — иначе деньги не вернутся гостю.
   */
  @Post('void-card-payment')
  @UseGuards(JwtGuard)
  async voidCardPayment(
    @Body() dto: { paymentId: string; reason: string },
    @Req() req: any,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
      include: { order: { select: { number: true, closedAt: true } } },
    });
    if (!payment) throw new BadRequestException({ code: 'PAYMENT_NOT_FOUND' });
    if (payment.status === 'VOIDED') {
      return { ok: true, alreadyVoided: true };
    }

    await this.prisma.payment.update({
      where: { id: dto.paymentId },
      data: { status: 'VOIDED', voidedAt: new Date(), voidReason: dto.reason },
    });

    return {
      ok: true,
      // Напоминание обязательное: отметка в системе не возвращает
      // деньги. Без возврата на терминале гость останется без денег,
      // а заведение — с претензией
      reminder: 'Сделайте возврат на банковском терминале — система деньги не возвращает',
      orderNumber: payment.order?.number,
      amount: payment.amount,
    };
  }
}

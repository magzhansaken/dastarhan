// apps/api/src/billing/billing.controller.ts
// Оплата подписки. Счёт, приём платежа, продление периода.
//
// Ключевое решение: оплата продлевает период ОТ ТЕКУЩЕГО КОНЦА,
// а не от даты платежа. Заплатил на неделю раньше — не потерял неделю.
// У конкурентов ранняя оплата часто съедает остаток текущего периода.
import {
  Body, Controller, Get, Post, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

class PayDto {
  @IsInt() @Min(1, { message: 'Сумма должна быть больше нуля' })
  amount!: number;

  @IsIn(['KASPI', 'CARD', 'TRANSFER', 'CASH'], { message: 'Неизвестный способ оплаты' })
  method!: string;

  // Ссылка на платёж в банке — для сверки выписки
  @IsOptional() @IsString() externalRef?: string;

  @IsOptional() @IsInt() @Min(1) months?: number;
}

@Controller('billing')
@UseGuards(JwtGuard)
export class BillingController {
  constructor(private prisma: PrismaService) {}

  /** Счёт к оплате: сколько и за что. */
  @Get('invoice')
  async invoice(@Req() req: any) {
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new NotFoundException({ code: 'NO_SUBSCRIPTION' });

    const plan = await this.prisma.plan.findUnique({ where: { id: sub.planId } });
    const locations = await this.prisma.location.findMany({
      where: { accountId: req.user.acc, isActive: true },
      select: { id: true, name: true },
    });

    const terminals = await this.prisma.terminal.groupBy({
      by: ['locationId'],
      where: { locationId: { in: locations.map((l) => l.id) }, isActive: true },
      _count: { id: true },
    }).catch(() => [] as any[]);

    const termBy = new Map((terminals as any[]).map((t) => [t.locationId, t._count.id]));
    const included = plan?.terminalsPerLocation ?? 1;
    const extra = locations.reduce(
      (s, l) => s + Math.max(0, (termBy.get(l.id) ?? 0) - included), 0);

    const base = (plan?.pricePerLocationMonth ?? 0) * locations.length;
    // Цена дополнительной кассы — треть от точки: касса без своей
    // аренды и без своего склада стоит дешевле
    const extraPrice = Math.round((plan?.pricePerLocationMonth ?? 0) / 3);

    const now = new Date();
    const daysLeft = Math.max(0,
      Math.ceil((sub.periodEnd.getTime() - now.getTime()) / 86400_000));

    const grace = new Date(sub.periodEnd);
    grace.setDate(grace.getDate() + (sub.graceDays ?? 7));

    // Три состояния экрана из макета: оплачено, скоро истекает,
    // просрочено. Каждое со своим тоном — при просрочке не пугаем,
    // а напоминаем, что касса продолжает работать
    const screenState =
      now > grace ? 'suspended'
      : now > sub.periodEnd ? 'overdue'
      : daysLeftOf(sub.periodEnd) <= 5 ? 'soon'
      : 'paid';

    function daysLeftOf(d: Date) {
      return Math.ceil((d.getTime() - now.getTime()) / 86400_000);
    }

    return {
      plan: plan?.code ?? null,
      planName: plan?.name ?? null,
      status: sub.status,
      screenState,
      stateMessage:
        screenState === 'paid' ? 'Всё оплачено — работайте спокойно'
        : screenState === 'soon' ? 'Подписка заканчивается — продлите, чтобы отчёты остались открыты'
        : screenState === 'overdue' ? 'Касса работает, отчёты откроются после оплаты'
        : 'Grace-период закончился — касса в режиме только чтения',
      graceUntil: grace,
      periodEnd: sub.periodEnd,
      daysLeft,
      lines: [
        {
          label: `Тариф «${plan?.name ?? '—'}» · ${locations.length} ${this.plural(locations.length, 'точка', 'точки', 'точек')}`,
          qty: locations.length,
          unit: plan?.pricePerLocationMonth ?? 0,
          sum: base,
        },
        ...(extra > 0 ? [{
          label: 'Дополнительные кассы',
          qty: extra, unit: extraPrice, sum: extra * extraPrice,
        }] : []),
      ],
      total: base + extra * extraPrice,
      // Годовая оплата со скидкой: два месяца в подарок —
      // это дешевле для клиента и предсказуемее для нас
      yearlyTotal: Math.round((base + extra * extraPrice) * 10),
      yearlyDiscountMonths: 2,
    };
  }

  /**
   * Зарегистрировать оплату. Пока Kaspi не подключён, платёж заводится
   * вручную владельцем или менеджером — деньги приходят на счёт,
   * подписка продлевается.
   */
  @Post('pay')
  async pay(@Body() dto: PayDto, @Req() req: any) {
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new NotFoundException({ code: 'NO_SUBSCRIPTION' });

    const months = dto.months ?? 1;

    // Продлеваем от конца текущего периода, а не от сегодня:
    // заплатил заранее — не потерял оплаченные дни
    const from = sub.periodEnd > new Date() ? sub.periodEnd : new Date();
    const to = new Date(from);
    to.setMonth(to.getMonth() + months);

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subPayment.create({
        data: {
          subId: sub.id,
          amount: dto.amount,
          method: dto.method,
          periodFrom: from,
          periodTo: to,
        },
      });

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          periodStart: from,
          periodEnd: to,
        },
      });

      return { payment, updated };
    });

    return {
      ok: true,
      paymentId: result.payment.id,
      status: result.updated.status,
      periodEnd: result.updated.periodEnd,
      months,
      message: `Оплачено до ${result.updated.periodEnd.toLocaleDateString('ru-RU')}`,
    };
  }

  /**
   * Закрывающие документы: счёт, акт, накладная.
   * Бухгалтеру клиента они нужны в тот же день, а не в конце месяца —
   * иначе платёж зависает в подвешенном состоянии.
   */
  @Get('documents')
  async documents(@Req() req: any) {
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return { entity: null, documents: [] };

    const payments = await this.prisma.subPayment.findMany({
      where: { subId: sub.id },
      orderBy: { at: 'desc' },
      take: 24,
    });

    return {
      // Реквизиты получателя видны до оплаты: бухгалтер должен знать,
      // на кого платит, а не спрашивать по телефону
      entity: process.env.BILLING_ENTITY ?? 'ИП Смагулов Е.',
      note: `Оплата уходит на ${process.env.BILLING_ENTITY ?? 'ИП Смагулов Е.'}. Закрывающие документы придут на почту сразу.`,
      documents: payments.map((p) => ({
        paymentId: p.id,
        at: p.at,
        amount: p.amount,
        method: p.method,
        period: `${p.periodFrom.toLocaleDateString('ru-RU')} — ${p.periodTo.toLocaleDateString('ru-RU')}`,
        // Три документа на каждый платёж — то, что просит бухгалтерия
        files: [
          { kind: 'invoice', label: 'Счёт на оплату' },
          { kind: 'act', label: 'Акт выполненных работ' },
          { kind: 'receipt', label: 'Квитанция' },
        ],
      })),
    };
  }

  /** История платежей — для бухгалтерии и споров. */
  @Get('payments')
  async payments(@Req() req: any) {
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return [];

    const rows = await this.prisma.subPayment.findMany({
      where: { subId: sub.id },
      orderBy: { at: 'desc' },
      take: 50,
    });

    return rows.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      at: p.at,
    }));
  }

  private plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }
}

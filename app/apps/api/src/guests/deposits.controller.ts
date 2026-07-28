// apps/api/src/guests/deposits.controller.ts
// Депозиты гостей: предоплата за банкет, корпоративный счёт,
// абонемент в бильярдной.
//
// Баланс считается по истории транзакций, а не хранится полем.
// Поле рассинхронизируется при сбое, история — нет, и по ней
// всегда можно объяснить гостю, откуда взялась сумма.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class TopupDto {
  @IsString() customerId!: string;
  @IsInt() @Min(1, { message: 'Сумма должна быть больше нуля' }) amount!: number;
  @IsIn(['CASH', 'CARD', 'KASPI', 'TRANSFER']) method!: string;
  @IsOptional() @IsString() note?: string;
}

class SpendDto {
  @IsString() customerId!: string;
  @IsString() orderId!: string;
  @IsInt() @Min(1) amount!: number;
}

@Controller('deposits')
@UseGuards(JwtGuard, PermissionsGuard)
export class DepositsController {
  constructor(private prisma: PrismaService) {}

  /** Баланс гостя с историей. */
  @Get('balance')
  @RequirePermission('crm.customer.view')
  async balance(@Query('customerId') customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND' });

    const txs = await this.prisma.depositTx.findMany({
      where: { customerId },
      orderBy: { at: 'desc' },
      take: 100,
    });

    // Пополнения плюсом, траты минусом — знак задаётся типом,
    // а не хранится отдельно: меньше мест для ошибки
    const sign = (type: string) => (type === 'TOPUP' || type === 'REFUND' ? 1 : -1);
    const balance = txs.reduce((s, t) => s + sign(t.type) * t.amount, 0);

    return {
      customerId: customer.id,
      name: customer.name,
      phone: customer.phone,
      balance,
      // Отрицательный баланс — гость ушёл в минус: разрешаем,
      // но помечаем. В корпоративных счетах это норма до конца месяца
      inDebt: balance < 0,
      history: txs.map((t) => ({
        id: t.id,
        type: t.type,
        amount: sign(t.type) * t.amount,
        at: t.at,
        orderId: t.orderId,
        label:
          t.type === 'TOPUP' ? 'Пополнение'
          : t.type === 'PAYMENT' ? 'Оплата заказа'
          : t.type === 'REFUND' ? 'Возврат'
          : t.type === 'DEBT_REPAY' ? 'Погашение долга'
          : 'Корректировка',
      })),
    };
  }

  /** Пополнить депозит: предоплата за банкет или взнос на счёт. */
  @Post('topup')
  @RequirePermission('crm.customer.edit')
  async topup(@Body() dto: TopupDto, @Req() req: any) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND' });

    const tx = await this.prisma.depositTx.create({
      data: {
        customerId: dto.customerId,
        type: 'TOPUP',
        amount: dto.amount,
        byUserId: req.user.sub,
      },
    });

    const b = await this.balance(dto.customerId);
    return { ok: true, txId: tx.id, balance: b.balance };
  }

  /**
   * Списать с депозита при оплате заказа.
   * Проверяем баланс, но разрешаем уйти в минус: корпоративный
   * клиент платит в конце месяца, и блокировать его в обед нельзя.
   */
  @Post('spend')
  @RequirePermission('order.create')
  async spend(@Body() dto: SpendDto, @Req() req: any) {
    const b = await this.balance(dto.customerId);

    // Предупреждаем, но не запрещаем: решение принимает кассир,
    // а он знает своего постоянного гостя лучше системы
    const willBe = b.balance - dto.amount;

    const tx = await this.prisma.depositTx.create({
      data: {
        customerId: dto.customerId,
        type: 'PAYMENT',
        amount: dto.amount,
        orderId: dto.orderId,
        byUserId: req.user.sub,
      },
    });

    return {
      ok: true,
      txId: tx.id,
      balance: willBe,
      warning: willBe < 0
        ? `Депозит ушёл в минус на ${Math.trunc(-willBe / 100)} ₸`
        : willBe < 100000
        ? `Осталось ${Math.trunc(willBe / 100)} ₸ — предложите пополнить`
        : null,
    };
  }

  /** Вернуть остаток депозита: банкет отменили. */
  @Post('refund')
  @RequirePermission('crm.customer.edit')
  async refund(@Body() dto: { customerId: string; amount: number }, @Req() req: any) {
    const b = await this.balance(dto.customerId);
    if (dto.amount > b.balance) {
      throw new BadRequestException({
        code: 'OVER_BALANCE',
        message: `На депозите ${Math.trunc(b.balance / 100)} ₸ — вернуть больше нельзя`,
      });
    }

    await this.prisma.depositTx.create({
      data: {
        customerId: dto.customerId,
        type: 'REFUND',
        amount: -dto.amount,
        byUserId: req.user.sub,
      },
    });

    return { ok: true, balance: b.balance - dto.amount };
  }

  /**
   * Список депозитов: у кого лежат наши деньги и кто должен нам.
   * Это обязательство заведения — гость может прийти за ним завтра.
   */
  @Get('list')
  @RequirePermission('finance.view')
  async list(@Req() req: any) {
    const customers = await this.prisma.customer.findMany({
      where: { accountId: req.user.acc, isActive: true },
      select: { id: true, name: true, phone: true },
      take: 500,
    });

    const txs = await this.prisma.depositTx.findMany({
      where: { customerId: { in: customers.map((c) => c.id) } },
      select: { customerId: true, type: true, amount: true },
    });

    const sign = (t: string) => (t === 'TOPUP' || t === 'REFUND' ? 1 : -1);
    const balBy = new Map<string, number>();
    for (const t of txs) {
      balBy.set(t.customerId, (balBy.get(t.customerId) ?? 0) + sign(t.type) * t.amount);
    }

    const rows = customers
      .map((c) => ({ ...c, balance: balBy.get(c.id) ?? 0 }))
      .filter((c) => c.balance !== 0)
      .sort((a, b) => b.balance - a.balance);

    const owed = rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0);
    const debt = rows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0);

    return {
      // Депозиты — не выручка, а обязательство: гость может забрать
      // деньги завтра, и в отчёте о прибыли их быть не должно
      note: 'Депозиты — обязательство заведения, а не выручка',
      totalOwed: owed,
      totalDebt: -debt,
      rows,
    };
  }
}

// apps/api/src/cash/tips.controller.ts
// Чаевые: приём, деление, выплата.
//
// Главное правило: чаевые не выручка заведения. Попадут в доход —
// владелец заплатит налог с денег официанта и увидит выручку,
// которой у него нет.
//
// Второе: официант должен получить ровно то, что ему дали,
// минус честно названная комиссия банка.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class TipDto {
  @IsString() locationId!: string;
  @IsInt() @Min(1) amount!: number;
  @IsIn(['CASH', 'CARD', 'QR', 'KASPI']) method!: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() orderId?: string;
  @IsOptional() @IsString() shiftId?: string;
  /** true — в общий котёл, false — конкретному официанту */
  @IsOptional() toPool?: boolean;
}

/** Комиссия за перевод: официант должен знать, сколько дойдёт. */
const FEE_PCT: Record<string, number> = {
  CASH: 0,
  CARD: 0,     // уже в эквайринге заведения
  QR: 0,
  KASPI: 0,
};

@Controller('tips')
@UseGuards(JwtGuard, PermissionsGuard)
export class TipsController {
  constructor(private prisma: PrismaService) {}

  /** Записать чаевые. */
  @Post()
  @RequirePermission('order.create')
  async create(@Body() dto: TipDto, @Req() req: any) {
    const fee = Math.round(dto.amount * (FEE_PCT[dto.method] ?? 0) / 100);

    let poolId: string | null = null;
    if (dto.toPool) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let pool = await this.prisma.tipPool.findFirst({
        where: {
          locationId: dto.locationId,
          date: today,
          status: 'OPEN',
        },
      });
      if (!pool) {
        pool = await this.prisma.tipPool.create({
          data: {
            accountId: req.user.acc,
            locationId: dto.locationId,
            shiftId: dto.shiftId ?? null,
            date: today,
          },
        });
      }
      await this.prisma.tipPool.update({
        where: { id: pool.id },
        data: { total: { increment: dto.amount - fee } },
      });
      poolId = pool.id;
    }

    const tip = await this.prisma.tip.create({
      data: {
        accountId: req.user.acc,
        locationId: dto.locationId,
        orderId: dto.orderId ?? null,
        userId: dto.toPool ? null : (dto.userId ?? req.user.sub),
        poolId,
        amount: dto.amount,
        method: dto.method as any,
        feeAmount: fee,
        shiftId: dto.shiftId ?? null,
      },
    });

    return {
      tipId: tip.id,
      amount: dto.amount,
      fee,
      netAmount: dto.amount - fee,
      toPool: !!dto.toPool,
      // Напоминание про учёт: кассир должен понимать, что эти
      // деньги не в кассе заведения
      note: dto.method === 'CASH'
        ? 'Наличные чаевые не идут в кассу — отдайте официанту'
        : null,
    };
  }

  /**
   * Мои чаевые: сколько заработал и сколько ещё не выплачено.
   * Официант проверяет с телефона, а не спрашивает у бухгалтера.
   */
  @Get('my')
  @RequirePermission('order.create')
  async my(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const [direct, shares] = await Promise.all([
      this.prisma.tip.findMany({
        where: { userId: req.user.sub, createdAt: { gte: from } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tipShare.findMany({
        where: { userId: req.user.sub, pool: { date: { gte: from } } },
        include: { pool: { select: { date: true, status: true } } },
      }),
    ]);

    const directNet = direct.reduce((s, t) => s + (t.amount - t.feeAmount), 0);
    const poolNet = shares.reduce((s, sh) => s + sh.amount, 0);
    const unpaid = direct.filter((t) => !t.paidOutAt).reduce((s, t) => s + (t.amount - t.feeAmount), 0)
      + shares.filter((s2) => !s2.paidAt).reduce((s, sh) => s + sh.amount, 0);

    // По дням: официант видит, когда работал результативнее
    const byDay = new Map<string, number>();
    for (const t of direct) {
      const k = t.createdAt.toISOString().slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + t.amount - t.feeAmount);
    }
    for (const sh of shares) {
      const k = sh.pool.date.toISOString().slice(0, 10);
      byDay.set(k, (byDay.get(k) ?? 0) + sh.amount);
    }

    const daysWorked = byDay.size;

    return {
      periodDays: Number(days),
      total: directNet + poolNet,
      fromGuests: directNet,
      fromPool: poolNet,
      unpaid,
      daysWorked,
      // Средние за смену — понятнее, чем итог за месяц
      avgPerDay: daysWorked ? Math.round((directNet + poolNet) / daysWorked) : 0,
      byDay: [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 30)
        .map(([date, amount]) => ({ date, amount })),
    };
  }

  /**
   * Разделить общий котёл по долям.
   *
   * Доли настраиваются: официант 1.0, бармен 0.7, повар 0.5.
   * Повар и посудомойка тоже участвуют — без них зал не работает,
   * и деление только между официантами рождает обиды.
   */
  @Post('pool/:id/split')
  @RequirePermission('finance.edit')
  async splitPool(
    @Param('id') id: string,
    @Body() dto: { shares: { userId: string; weight: number }[] },
    @Req() req: any,
  ) {
    const pool = await this.prisma.tipPool.findUnique({
      where: { id }, include: { shares: true },
    });
    if (!pool) throw new NotFoundException({ code: 'POOL_NOT_FOUND' });
    if (pool.status !== 'OPEN') {
      throw new BadRequestException({ code: 'ALREADY_CLOSED' });
    }
    if (!dto.shares.length) throw new BadRequestException({ code: 'NO_SHARES' });

    const totalWeight = dto.shares.reduce((s, x) => s + x.weight, 0);
    if (totalWeight <= 0) throw new BadRequestException({ code: 'BAD_WEIGHTS' });

    let distributed = 0;
    const calc = dto.shares.map((s, i) => {
      // Последнему отдаём остаток: копейки при делении не должны
      // теряться — они чужие
      const amount = i === dto.shares.length - 1
        ? pool.total - distributed
        : Math.round(pool.total * s.weight / totalWeight);
      distributed += amount;
      return { ...s, amount };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.tipShare.deleteMany({ where: { poolId: id } });
      for (const c of calc) {
        await tx.tipShare.create({
          data: {
            poolId: id, userId: c.userId,
            weight: c.weight as any, amount: c.amount,
          },
        });
      }
      await tx.tipPool.update({
        where: { id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });

    const users = await this.prisma.user.findMany({
      where: { id: { in: calc.map((c) => c.userId) } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName] as const));

    return {
      ok: true,
      total: pool.total,
      shares: calc.map((c) => ({
        userId: c.userId,
        name: nameBy.get(c.userId) ?? '—',
        weight: c.weight,
        amount: c.amount,
      })),
      // Проверка: сумма долей равна котлу до копейки
      checkSum: calc.reduce((s, c) => s + c.amount, 0) === pool.total,
    };
  }

  /**
   * Отчёт по чаевым для владельца.
   * Важно: показываем отдельно от выручки и подписываем почему.
   */
  @Get('report')
  @RequirePermission('finance.view')
  async report(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const tips = await this.prisma.tip.findMany({
      where: { accountId: req.user.acc, createdAt: { gte: from } },
    });

    const orders = await this.prisma.order.aggregate({
      where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: from } },
      _sum: { total: true }, _count: true,
    });

    const total = tips.reduce((s, t) => s + t.amount, 0);
    const revenue = orders._sum.total ?? 0;

    const byMethod = ['CASH', 'CARD', 'QR', 'KASPI'].map((m) => ({
      method: m,
      label: m === 'CASH' ? 'Наличными' : m === 'CARD' ? 'Картой'
        : m === 'QR' ? 'По QR' : 'Kaspi',
      count: tips.filter((t) => t.method === m).length,
      sum: tips.filter((t) => t.method === m).reduce((s, t) => s + t.amount, 0),
    })).filter((x) => x.count > 0);

    const byUser = new Map<string, number>();
    for (const t of tips) {
      if (!t.userId) continue;
      byUser.set(t.userId, (byUser.get(t.userId) ?? 0) + t.amount);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byUser.keys()] } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName] as const));

    return {
      periodDays: Number(days),
      total,
      count: tips.length,
      avgTip: tips.length ? Math.round(total / tips.length) : 0,
      // Доля от выручки: норма 3–7%. Ниже — гости недовольны
      // или официанты не умеют, выше — щедрая публика
      pctOfRevenue: revenue > 0 ? +((total / revenue) * 100).toFixed(1) : 0,
      tipsPerCheck: orders._count ? Math.round(total / orders._count) : 0,
      byMethod,
      byUser: [...byUser.entries()].map(([id, sum]) => ({
        userId: id, name: nameBy.get(id) ?? '—', sum,
      })).sort((a, b) => b.sum - a.sum),
      // Подпись обязательна: без неё бухгалтер включит чаевые
      // в выручку и заплатит лишний налог
      accountingNote: 'Чаевые не входят в выручку и не облагаются налогом заведения',
    };
  }
}

// apps/api/src/guests/loyalty.controller.ts
// Лояльность: бонусы, купоны, акции.
//
// Главное отличие от iikoCard: у них лояльность — отдельный
// платный продукт с регистрацией гостя. У нас купон работает
// по коду без регистрации: гость пришёл с флаера и получил скидку,
// не оставляя телефон.
import {
  Body, Controller, Get, Post, Param, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class CouponDto {
  @IsString() @Length(3, 24) code!: string;
  @IsString() @Length(3, 80) title!: string;
  @IsIn(['PERCENT', 'AMOUNT', 'FREE_ITEM']) kind!: string;
  @IsInt() @Min(1) value!: number;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsInt() @Min(0) minTotal?: number;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) perGuest?: number;
  @IsOptional() @IsString() endsAt?: string;
}

@Controller('loyalty')
export class LoyaltyController {
  constructor(private prisma: PrismaService) {}

  /**
   * Проверка купона на кассе. Отвечает до применения:
   * кассир видит, сработает ли код, и что сказать гостю при отказе.
   */
  @Get('coupon/:code')
  @UseGuards(JwtGuard)
  async checkCoupon(
    @Param('code') code: string,
    @Query('total') total: string,
    @Query('customerId') customerId: string | undefined,
    @Req() req: any,
  ) {
    const coupon = await this.prisma.coupon.findFirst({
      where: { accountId: req.user.acc, code: code.trim().toUpperCase() },
    });

    // Причина отказа человеческим языком: кассиру нужно объяснить
    // гостю, а не показать код ошибки
    if (!coupon) {
      return { valid: false, reason: 'Такого кода нет — проверьте написание' };
    }
    if (!coupon.isActive) {
      return { valid: false, reason: 'Акция отключена' };
    }

    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      return {
        valid: false,
        reason: `Акция начнётся ${coupon.startsAt.toLocaleDateString('ru-RU')}`,
      };
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      return {
        valid: false,
        reason: `Акция закончилась ${coupon.endsAt.toLocaleDateString('ru-RU')}`,
      };
    }
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
      return { valid: false, reason: 'Купоны закончились — лимит исчерпан' };
    }

    const sum = Number(total) || 0;
    if (sum < coupon.minTotal) {
      const need = Math.trunc((coupon.minTotal - sum) / 100);
      return {
        valid: false,
        // Подсказываем, сколько добрать: гость чаще доложит,
        // чем откажется от скидки
        reason: `Нужен чек от ${Math.trunc(coupon.minTotal / 100)} ₸ — добавьте ещё ${need} ₸`,
      };
    }

    // Ограничение на гостя работает только если он опознан
    if (customerId && coupon.perGuest) {
      const used = await this.prisma.couponUse.count({
        where: { couponId: coupon.id, customerId },
      });
      if (used >= coupon.perGuest) {
        return { valid: false, reason: 'Этот гость уже использовал купон' };
      }
    }

    const discount = this.calcDiscount(coupon, sum);

    return {
      valid: true,
      couponId: coupon.id,
      title: coupon.title,
      kind: coupon.kind,
      discount,
      // Остаток купонов: кассир видит, что акция заканчивается,
      // и может предупредить следующих гостей
      left: coupon.maxUses ? coupon.maxUses - coupon.usedCount : null,
    };
  }

  /** Применить купон к заказу. */
  @Post('coupon/apply')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('order.discount.manual')
  async applyCoupon(
    @Body() dto: { code: string; orderId: string; customerId?: string },
    @Req() req: any,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (order.status !== 'OPEN') {
      throw new BadRequestException({
        code: 'ORDER_CLOSED',
        message: 'Заказ закрыт — скидку применять поздно',
      });
    }

    const check = await this.checkCoupon(
      dto.code, String(order.subtotal), dto.customerId, req,
    );
    if (!check.valid) {
      throw new BadRequestException({ code: 'COUPON_INVALID', message: check.reason });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: dto.orderId },
        data: {
          discount: { increment: check.discount! },
          total: { decrement: check.discount! },
        },
      });
      await tx.coupon.update({
        where: { id: check.couponId! },
        data: { usedCount: { increment: 1 } },
      });
      await tx.couponUse.create({
        data: {
          couponId: check.couponId!,
          orderId: dto.orderId,
          customerId: dto.customerId ?? null,
          amount: check.discount!,
        },
      });
    });

    return { ok: true, title: check.title, discount: check.discount };
  }

  /** Список купонов с эффективностью. */
  @Get('coupons')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('crm.bonus.adjust')
  async coupons(@Req() req: any) {
    const rows = await this.prisma.coupon.findMany({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
      include: { uses: { select: { amount: true, orderId: true } } },
    });

    const orderIds = rows.flatMap((c) => c.uses.map((u) => u.orderId));
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, total: true },
    });
    const totalBy = new Map(orders.map((o) => [o.id, o.total]));

    return rows.map((c) => {
      const given = c.uses.reduce((s, u) => s + u.amount, 0);
      const earned = c.uses.reduce((s, u) => s + (totalBy.get(u.orderId) ?? 0), 0);
      return {
        id: c.id, code: c.code, title: c.title, kind: c.kind, value: c.value,
        isActive: c.isActive,
        usedCount: c.usedCount,
        maxUses: c.maxUses,
        endsAt: c.endsAt,
        discountGiven: given,
        revenueEarned: earned,
        // Окупаемость акции: скидка 20% оправдана, если гость
        // потратил больше, чем без неё. Без этой цифры владелец
        // не знает, работает акция или проедает маржу
        ratio: given > 0 ? +(earned / given).toFixed(1) : null,
      };
    });
  }

  @Post('coupons')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('crm.bonus.adjust')
  async createCoupon(@Body() dto: CouponDto, @Req() req: any) {
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.coupon.findFirst({
      where: { accountId: req.user.acc, code },
    });
    if (exists) {
      throw new BadRequestException({
        code: 'CODE_TAKEN',
        message: `Код ${code} уже используется`,
      });
    }

    const c = await this.prisma.coupon.create({
      data: {
        accountId: req.user.acc,
        code, title: dto.title.trim(),
        kind: dto.kind as any,
        value: dto.value,
        productId: dto.productId ?? null,
        minTotal: dto.minTotal ?? 0,
        maxUses: dto.maxUses ?? null,
        perGuest: dto.perGuest ?? 1,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      },
    });
    return { id: c.id, code: c.code };
  }

  private calcDiscount(coupon: { kind: string; value: number }, total: number): number {
    if (coupon.kind === 'PERCENT') return Math.round(total * coupon.value / 100);
    if (coupon.kind === 'AMOUNT') return Math.min(coupon.value, total);
    return 0;   // FREE_ITEM считается по цене блюда при применении
  }
}

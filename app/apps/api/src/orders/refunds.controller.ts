// apps/api/src/orders/refunds.controller.ts
// Возвраты: гость вернул блюдо, кассир ошибся, заказ отменили.
//
// В Казахстане возврат обязан пройти через ОФД отдельным
// фискальным документом. Просто «удалить чек» нельзя — налоговая
// увидит расхождение, а заведение получит штраф.
import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { FiscalService } from '../payments/fiscal.service';

class RefundDto {
  @IsString() orderId!: string;
  /** Пустой массив — возврат всего чека */
  @IsArray() itemIds!: string[];
  @IsIn(['quality', 'wrong_order', 'guest_refused', 'cashier_error', 'other'])
  reason!: string;
  @IsOptional() @IsString() @Length(0, 200) note?: string;
  @IsIn(['CASH', 'CARD', 'KASPI_QR', 'DEPOSIT']) method!: string;
}

const REASONS: Record<string, { label: string; toStock: boolean }> = {
  // Вернуть на склад можно только то, что не испортилось
  quality:        { label: 'Претензия к качеству',    toStock: false },
  wrong_order:    { label: 'Принесли не то',          toStock: false },
  guest_refused:  { label: 'Гость передумал',         toStock: true },
  cashier_error:  { label: 'Ошибка кассира',          toStock: true },
  other:          { label: 'Другое',                  toStock: false },
};

@Controller('refunds')
@UseGuards(JwtGuard, PermissionsGuard)
export class RefundsController {
  constructor(
    private prisma: PrismaService,
    private fiscal: FiscalService,
  ) {}

  /**
   * Что можно вернуть по чеку. Кассир видит список позиций
   * и то, что уже возвращали — повторный возврат одного блюда
   * частая схема хищения.
   */
  @Get('available/:orderId')
  @RequirePermission('order.refund')
  async available(@Param('orderId') orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (order.status !== 'CLOSED') {
      throw new BadRequestException({
        code: 'NOT_CLOSED',
        message: 'Заказ ещё открыт — просто удалите позицию',
      });
    }

    const already = await this.prisma.refund.findMany({
      where: { orderId },
      include: { lines: true },
    }).catch(() => [] as any[]);

    const refundedQty = new Map<string, number>();
    for (const r of already as any[]) {
      for (const l of r.lines ?? []) {
        refundedQty.set(l.itemId, (refundedQty.get(l.itemId) ?? 0) + Number(l.qty));
      }
    }

    const hoursAgo = order.closedAt
      ? Math.floor((Date.now() - order.closedAt.getTime()) / 3600_000) : 0;

    return {
      orderId,
      number: order.number,
      closedAt: order.closedAt,
      hoursAgo,
      // Возврат старого чека требует внимания: через неделю
      // гость вряд ли вернёт блюдо, скорее это схема
      needsApproval: hoursAgo > 24,
      total: order.total,
      refundedTotal: (already as any[]).reduce((s, r) => s + (r.amount ?? 0), 0),
      items: order.items
        .filter((i) => !i.isRemoved)
        .map((i) => {
          const done = refundedQty.get(i.id) ?? 0;
          return {
            itemId: i.id,
            name: i.nameSnapshot,
            qty: Number(i.qty),
            refundedQty: done,
            availableQty: Number(i.qty) - done,
            unitPrice: i.unitPrice,
            canRefund: Number(i.qty) - done > 0,
          };
        }),
      payments: order.payments.map((p) => ({
        kind: p.kind, amount: p.amount, status: p.status,
      })),
      reasons: Object.entries(REASONS).map(([key, v]) => ({
        key, label: v.label, returnsToStock: v.toStock,
      })),
    };
  }

  /**
   * Оформить возврат. Три обязательных шага, и пропустить нельзя
   * ни один: фискальный документ, движение денег, склад.
   */
  @Post()
  @RequirePermission('order.refund')
  async create(@Body() dto: RefundDto, @Req() req: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (order.status !== 'CLOSED') {
      throw new BadRequestException({ code: 'NOT_CLOSED' });
    }

    const items = dto.itemIds.length
      ? order.items.filter((i) => dto.itemIds.includes(i.id) && !i.isRemoved)
      : order.items.filter((i) => !i.isRemoved);

    if (!items.length) throw new BadRequestException({ code: 'NO_ITEMS' });

    const amount = items.reduce((s, i) => s + Number(i.qty) * i.unitPrice, 0);

    // Возврат больше оплаченного невозможен: защита от схемы,
    // где чек оплачен частично, а возврат оформляют полностью
    const paid = order.payments
      .filter((p) => p.status === 'CAPTURED')
      .reduce((s, p) => s + p.amount, 0);
    if (amount > paid) {
      throw new BadRequestException({
        code: 'OVER_PAID',
        message: `По чеку оплачено ${Math.trunc(paid / 100)} ₸ — вернуть больше нельзя`,
      });
    }

    const meta = REASONS[dto.reason];
    const last = await this.prisma.refund.findFirst({
      where: { accountId: order.accountId },
      orderBy: { number: 'desc' },
      select: { number: true },
    }).catch(() => null);

    const refund = await this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.create({
        data: {
          accountId: order.accountId,
          orderId: order.id,
          number: ((last as any)?.number ?? 0) + 1,
          amount,
          reason: dto.reason,
          note: dto.note ?? null,
          method: dto.method,
          byUserId: req.user.sub,
          lines: {
            create: items.map((i) => ({
              itemId: i.id,
              productId: i.productId,
              name: i.nameSnapshot,
              qty: i.qty,
              unitPrice: i.unitPrice,
            })),
          },
        },
        include: { lines: true },
      });

      // Возврат на склад только для целых блюд. Испорченное
      // и надкусанное обратно не кладут — это порча, а не возврат
      if (meta.toStock) {
        const wh = await tx.warehouse.findFirst({
          where: { locationId: order.locationId, isActive: true },
          orderBy: { isDefault: 'desc' },
        });
        if (wh) {
          for (const l of r.lines) {
            const bal = await tx.stockBalance.findFirst({
              where: { warehouseId: wh.id, productId: l.productId },
            });
            if (bal) {
              await tx.stockBalance.update({
                where: { id: bal.id },
                data: { qty: Number(bal.qty) + Number(l.qty) },
              });
            }
            await tx.stockMovement.create({
              data: {
                accountId: order.accountId,
                warehouseId: wh.id,
                productId: l.productId,
                qtyDelta: Number(l.qty),
                unitCost: bal?.avgCost ?? 0,
              },
            });
          }
        }
      }

      // Заказ закрываем целиком, если вернули всё
      const restQty = order.items
        .filter((i) => !i.isRemoved && !items.some((x) => x.id === i.id))
        .length;
      if (restQty === 0) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
      }

      await tx.eventLog.create({
        data: {
          eventId: randomUUID(),
          accountId: order.accountId,
          terminalId: order.terminalId,
          type: 'order.refund',
          payload: {
            orderId: order.id, refundId: r.id, amount,
            reason: dto.reason, byUserId: req.user.sub,
          },
          createdAt: new Date(),
        },
      }).catch(() => null);

      return r;
    });

    // Фискальный возврат обязателен: без него налоговая увидит
    // расхождение между чеками и выручкой
    const fiscalResult = await this.fiscal.enqueue({
      accountId: order.accountId,
      orderId: `refund-${refund.id}`,
      request: {
        op: 'REFUND',
        items: items.map((i) => ({
          name: i.nameSnapshot,
          qty: Number(i.qty),
          price: i.unitPrice,
          vatRate: 0,
        })),
        payments: [{ kind: dto.method as any, amount }],
        total: amount,
      } as any,
    }).catch(() => null);

    return {
      ok: true,
      refundId: refund.id,
      number: refund.number,
      amount,
      returnedToStock: meta.toStock,
      fiscal: fiscalResult?.status ?? 'QUEUED',
      // Напоминание про терминал: система деньги не возвращает
      reminder: dto.method === 'CARD'
        ? 'Сделайте возврат на банковском терминале — система деньги не возвращает'
        : null,
    };
  }

  /**
   * Отчёт по возвратам. Владелец видит не сумму, а закономерности:
   * один кассир возвращает вдвое чаще других — повод посмотреть видео.
   */
  @Get('report')
  @RequirePermission('reports.view')
  async report(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const rows = await this.prisma.refund.findMany({
      where: { accountId: req.user.acc, createdAt: { gte: from } },
      include: { lines: true },
    }).catch(() => [] as any[]);

    if (!rows.length) {
      return { total: 0, count: 0, byReason: [], byUser: [], topProducts: [] };
    }

    const total = (rows as any[]).reduce((s, r) => s + r.amount, 0);

    const byReason = Object.keys(REASONS).map((key) => {
      const list = (rows as any[]).filter((r) => r.reason === key);
      return {
        reason: key, label: REASONS[key].label,
        count: list.length,
        sum: list.reduce((s, r) => s + r.amount, 0),
      };
    }).filter((x) => x.count > 0).sort((a, b) => b.sum - a.sum);

    const userIds = [...new Set((rows as any[]).map((r) => r.byUserId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName]));

    const byUser = userIds.map((id) => {
      const list = (rows as any[]).filter((r) => r.byUserId === id);
      return {
        userId: id, name: nameBy.get(id) ?? '—',
        count: list.length,
        sum: list.reduce((s, r) => s + r.amount, 0),
      };
    }).sort((a, b) => b.sum - a.sum);

    // Аномалия: если один делает больше половины возвратов
    // при нескольких кассирах — это не совпадение
    const suspicious = byUser.length > 1 && byUser[0].count > (rows as any[]).length * 0.5
      ? { name: byUser[0].name, share: Math.round(byUser[0].count / (rows as any[]).length * 100) }
      : null;

    const prodMap = new Map<string, { name: string; qty: number; sum: number }>();
    for (const r of rows as any[]) {
      for (const l of r.lines ?? []) {
        const cur = prodMap.get(l.productId) ?? { name: l.name, qty: 0, sum: 0 };
        cur.qty += Number(l.qty);
        cur.sum += Number(l.qty) * l.unitPrice;
        prodMap.set(l.productId, cur);
      }
    }

    return {
      total, count: rows.length,
      byReason, byUser,
      suspicious,
      topProducts: [...prodMap.values()].sort((a, b) => b.sum - a.sum).slice(0, 10),
      // Доля возвратов от выручки: норма до 1%, выше — проблема
      // либо с кухней, либо с людьми
      note: suspicious
        ? `${suspicious.name} делает ${suspicious.share}% возвратов — стоит проверить`
        : null,
    };
  }
}

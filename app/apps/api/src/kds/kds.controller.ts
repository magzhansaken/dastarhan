// apps/api/src/kds/kds.controller.ts
// Экран кухни. Повар видит, что готовить, и отмечает готовность.
//
// Тикеты сортируются по времени поступления, а не по номеру заказа:
// кто раньше заказал — того раньше готовят, иначе гость за первым
// столом ждёт дольше, чем за пятым.
import {
  Body, Controller, Get, Post, Query, UseGuards,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

class ItemStatusDto {
  @IsString() itemId!: string;

  @IsIn(['COOKING', 'READY'], { message: 'Статус: COOKING или READY' })
  status!: 'COOKING' | 'READY';
}

@Controller('kds')
@UseGuards(JwtGuard)
export class KdsController {
  constructor(private prisma: PrismaService) {}

  /**
   * Тикеты кухни: открытые заказы с неготовыми позициями.
   * Готовые целиком заказы уходят с экрана сами — повару не нужно
   * листать вчерашнее, чтобы найти текущее.
   */
  @Get('tickets')
  async tickets(@Query('locationId') locationId: string) {
    const orders = await this.prisma.order.findMany({
      where: { locationId, status: 'OPEN' },
      include: {
        items: { where: { isRemoved: false } },
        table: { select: { name: true } },
      },
      orderBy: { openedAt: 'asc' },
      take: 50,
    });

    const now = Date.now();

    return orders
      .map((o) => {
        const items = o.items.filter((i) => i.kitchenStatus !== 'READY');
        if (!items.length) return null;

        const waitedMin = Math.floor((now - o.openedAt.getTime()) / 60000);

        return {
          orderId: o.id,
          number: o.number,
          tableName: o.table?.name ?? null,
          mode: o.mode,
          openedAt: o.openedAt,
          waitedMin,
          // Порог 15 минут: дольше — гость начинает нервничать,
          // и повар должен видеть это раньше, чем придёт официант
          isLate: waitedMin > 15,
          items: items.map((i) => ({
            itemId: i.id,
            name: i.nameSnapshot,
            qty: Number(i.qty),
            comment: i.comment,
            status: i.kitchenStatus,
          })),
        };
      })
      .filter((t) => t !== null);
  }

  /** Отметить позицию: взял в работу или готово. */
  @Post('item-status')
  async itemStatus(@Body() dto: ItemStatusDto) {
    const item = await this.prisma.orderItem.findUnique({ where: { id: dto.itemId } });
    if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND' });
    if (item.isRemoved) throw new BadRequestException({ code: 'ITEM_REMOVED' });

    await this.prisma.orderItem.update({
      where: { id: dto.itemId },
      data: {
        kitchenStatus: dto.status,
        ...(dto.status === 'COOKING' && !item.sentAt ? { sentAt: new Date() } : {}),
      },
    });

    // Осталось ли что готовить — официант узнает, что можно нести,
    // не переспрашивая повара
    const left = await this.prisma.orderItem.count({
      where: { orderId: item.orderId, isRemoved: false, kitchenStatus: { not: 'READY' } },
    });

    return { ok: true, itemId: dto.itemId, status: dto.status, orderComplete: left === 0 };
  }

  /**
   * Сводка по партиям: повар видит «Плов ×7» и делает разом,
   * а не семь раз подряд одно и то же.
   */
  @Get('batch')
  async batch(@Query('locationId') locationId: string) {
    const orders = await this.prisma.order.findMany({
      where: { locationId, status: 'OPEN' },
      include: { items: { where: { isRemoved: false } } },
    });

    const byProduct = new Map<string, { name: string; qty: number }>();
    for (const o of orders) {
      for (const i of o.items) {
        if (i.kitchenStatus === 'READY') continue;
        const cur = byProduct.get(i.productId);
        byProduct.set(i.productId, {
          name: i.nameSnapshot,
          qty: (cur?.qty ?? 0) + Number(i.qty),
        });
      }
    }

    return [...byProduct.values()]
      .filter((x) => x.qty > 1)
      .sort((a, b) => b.qty - a.qty);
  }
}

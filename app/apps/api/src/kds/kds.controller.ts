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
  async tickets(
    @Query('locationId') locationId: string,
    @Query('stationId') stationId?: string,
  ) {
    // Цех повара: у мангала не должны висеть салаты, а у бармена —
    // горячее. Без фильтра экран превращается в свалку
    const stationProducts = stationId
      ? new Set((await this.prisma.product.findMany({
          where: { stationId }, select: { id: true },
        })).map((p) => p.id))
      : null;

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
        const items = o.items.filter((i) =>
          i.kitchenStatus !== 'READY' &&
          (!stationProducts || stationProducts.has(i.productId)));
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

  /** Цеха точки — для переключателя на экране кухни. */
  @Get('stations')
  async stations(@Query('locationId') locationId: string) {
    const list = await this.prisma.station.findMany({
      where: { locationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    });
    // «Все цеха» первым: маленькое кафе работает без разделения,
    // и переключатель не должен мешать
    return [{ id: 'all', name: 'Все цеха' }, ...list];
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

  // ═══════════════ ЭЛЕКТРОННАЯ ОЧЕРЕДЬ ═══════════════

  /**
   * Табло выдачи для фастфуда. Гость взял номерок и смотрит на экран,
   * а не толпится у стойки и не переспрашивает «мой готов?».
   *
   * Два списка: готовится и готово. Готовые держим пять минут после
   * выдачи — гость мог отойти, и номер должен ещё повисеть.
   */
  @Get('queue')
  async queue(@Query('locationId') locationId: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        locationId,
        status: { in: ['OPEN', 'CLOSED'] },
        openedAt: { gte: new Date(Date.now() - 2 * 3600_000) },
      },
      include: { items: { where: { isRemoved: false } } },
      orderBy: { openedAt: 'asc' },
      take: 40,
    });

    const cooking: any[] = [];
    const ready: any[] = [];
    const now = Date.now();

    for (const o of orders) {
      if (!o.items.length) continue;
      const allReady = o.items.every((i) => i.kitchenStatus === 'READY');
      const waited = Math.floor((now - o.openedAt.getTime()) / 60000);

      // Номер на табло короткий: гость запоминает две цифры,
      // а не восьмизначный идентификатор заказа
      const shortNo = o.number % 100;

      if (allReady) {
        // Выданные заказы уходят с табло через 5 минут после закрытия
        if (o.status === 'CLOSED' && o.closedAt &&
            now - o.closedAt.getTime() > 5 * 60_000) continue;
        ready.push({ number: shortNo, fullNumber: o.number, waited });
      } else if (o.status === 'OPEN') {
        cooking.push({ number: shortNo, fullNumber: o.number, waited });
      }
    }

    return {
      cookingTitle: 'Готовится',
      readyTitle: 'Готово — забирайте',
      cooking,
      ready,
      // Среднее ожидание на табло: гость видит, сколько примерно ждать,
      // и не нервничает через три минуты
      avgWaitMin: cooking.length
        ? Math.round(cooking.reduce((s, c) => s + c.waited, 0) / cooking.length) : 0,
    };
  }
}

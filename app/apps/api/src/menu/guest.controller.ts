// apps/api/src/menu/guest.controller.ts
// Публичное меню для гостя: он сканирует QR на столе и открывает
// страницу в браузере. Авторизации нет и быть не может — гость
// не станет ничего устанавливать и вводить.
//
// Токеном служит идентификатор стола — это cuid, угадать его нельзя,
// а знание не даёт ничего, кроме просмотра меню и вызова официанта.
import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../core/prisma.service';

class CallWaiterDto {
  @IsString() tableToken!: string;
}

@Controller('guest')
export class GuestController {
  constructor(private prisma: PrismaService) {}

  /** Меню стола по токену из QR-кода. */
  @Get('menu/:token')
  async menu(@Param('token') token: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: token, isActive: true },
      include: { hall: true },
    });
    if (!table) throw new NotFoundException({ code: 'TABLE_NOT_FOUND' });

    // У Hall нет relation на Location — только locationId,
    // поэтому точку и аккаунт читаем отдельными запросами
    const location = await this.prisma.location.findUnique({
      where: { id: table.hall.locationId },
      include: { account: true },
    });
    if (!location) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });

    const [categories, products, stops, prices] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { isDeleted: false, accountId: location.accountId },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.product.findMany({
        where: {
          isDeleted: false,
          accountId: location.accountId,
          type: { in: ['DISH', 'GOODS'] },
        },
        select: {
          id: true, name: true, nameKk: true, categoryId: true,
          basePrice: true, imageUrl: true, nutrition: true, unit: true,
        },
      }),
      this.prisma.stopListEntry.findMany({
        where: { locationId: location.id },
        select: { productId: true },
      }),
      this.prisma.productPrice.findMany({ where: { locationId: location.id } }),
    ]);

    const stopped = new Set(stops.map((s) => s.productId));
    const priceBy = new Map(prices.map((p) => [p.productId, p.price] as const));

    return {
      shopName: location.account.name,
      tableName: table.name,
      tableToken: token,
      // Wi-Fi прямо в меню: гость первым делом ищет пароль,
      // и официанта из-за этого зовут чаще, чем из-за заказа
      wifi: process.env.GUEST_WIFI ?? null,
      // Процент обслуживания показываем до заказа, а не в счёте —
      // иначе сюрприз в конце ужина портит впечатление
      servicePct: Number(process.env.SERVICE_PCT ?? 0) || null,
      // Самостоятельный заказ со стола владелец включает сам:
      // не каждому заведению это подходит
      selfOrderEnabled: process.env.GUEST_SELF_ORDER === 'true',
      categories: categories.map((c) => ({
        id: c.id, name: c.name, nameKk: c.nameKk, color: c.color,
      })),
      // Блюда в стопе гостю не показываем вовсе: увидеть недоступное
      // и расстроиться хуже, чем не увидеть
      items: products
        // Гостю не показываем стопы и позиции с нулевой ценой:
        // «Стакан бумажный · 0 ₸» — это расходник, а не блюдо
        .filter((p) => !stopped.has(p.id) && (priceBy.get(p.id) ?? p.basePrice) > 0)
        .map((p) => ({
          productId: p.id,
          name: p.name,
          nameKk: p.nameKk,
          categoryId: p.categoryId,
          price: priceBy.get(p.id) ?? p.basePrice,
          imageUrl: p.imageUrl,
          // Вес порции и состав: гость выбирает глазами, но решает
          // по граммам — «420 г» отвечает на вопрос «наемся ли»
          nutrition: p.nutrition ?? null,
          unit: p.unit,
        })),
    };
  }

  /**
   * Заказ со стола. Не создаём заказ сразу — пишем событие,
   * которое кассир подтверждает. Иначе шутник за столом
   * набьёт кассе десять бешбармаков.
   */
  @Post('table-order')
  async tableOrder(@Body() dto: { tableToken: string; items?: any[]; comment?: string }) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: dto.tableToken, isActive: true },
      include: { hall: true },
    });
    if (!table) throw new NotFoundException({ code: 'TABLE_NOT_FOUND' });

    const location = await this.prisma.location.findUnique({
      where: { id: table.hall.locationId },
      select: { accountId: true },
    });
    if (!location) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });

    await this.prisma.eventLog.create({
      data: {
        eventId: randomUUID(),
        accountId: location.accountId,
        terminalId: null,
        type: 'guest.table_order',
        payload: {
          tableId: table.id,
          tableName: table.name,
          items: dto.items ?? [],
          comment: dto.comment ?? null,
        },
        createdAt: new Date(),
      },
    }).catch(() => null);

    return { ok: true, tableName: table.name, needsConfirm: true };
  }

  /**
   * Позвать официанта. Создаём событие, которое увидит зал —
   * гостю не нужно махать рукой и ловить взгляд.
   */
  @Post('call-waiter')
  async callWaiter(@Body() dto: CallWaiterDto) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: dto.tableToken, isActive: true },
      include: { hall: true },
    });
    if (!table) throw new NotFoundException({ code: 'TABLE_NOT_FOUND' });

    const location = await this.prisma.location.findUnique({
      where: { id: table.hall.locationId },
      select: { accountId: true },
    });
    if (!location) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });

    await this.prisma.eventLog.create({
      data: {
        eventId: randomUUID(),
        accountId: location.accountId,
        terminalId: null,
        type: 'guest.waiter_called',
        payload: { tableId: table.id, tableName: table.name },
        createdAt: new Date(),
      },
    }).catch(() => null);

    return { ok: true, tableName: table.name };
  }
}

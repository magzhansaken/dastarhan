// apps/api/src/menu/guest.controller.ts
// Публичное меню для гостя: он сканирует QR на столе и открывает
// страницу в браузере. Авторизации нет и быть не может — гость
// не станет ничего устанавливать и вводить.
//
// Токеном служит идентификатор стола — это cuid, угадать его нельзя,
// а знание не даёт ничего, кроме просмотра меню и вызова официанта.
import { Controller, Get, Post, Body, Param, NotFoundException } from '@nestjs/common';
import { IsString } from 'class-validator';
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
      include: { hall: { include: { location: { include: { account: true } } } } },
    });
    if (!table) throw new NotFoundException({ code: 'TABLE_NOT_FOUND' });

    const location = table.hall.location;

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
          basePrice: true, imageUrl: true, nutrition: true,
        },
      }),
      this.prisma.stopListEntry.findMany({
        where: { locationId: location.id },
        select: { productId: true },
      }),
      this.prisma.productPrice.findMany({ where: { locationId: location.id } }),
    ]);

    const stopped = new Set(stops.map((s) => s.productId));
    const priceBy = new Map(prices.map((p) => [p.productId, p.price]));

    return {
      shopName: location.account.name,
      tableName: table.name,
      tableToken: token,
      categories: categories.map((c) => ({
        id: c.id, name: c.name, nameKk: c.nameKk, color: c.color,
      })),
      // Блюда в стопе гостю не показываем вовсе: увидеть недоступное
      // и расстроиться хуже, чем не увидеть
      items: products
        .filter((p) => !stopped.has(p.id))
        .map((p) => ({
          productId: p.id,
          name: p.name,
          nameKk: p.nameKk,
          categoryId: p.categoryId,
          price: priceBy.get(p.id) ?? p.basePrice,
          imageUrl: p.imageUrl,
        })),
    };
  }

  /**
   * Позвать официанта. Создаём событие, которое увидит зал —
   * гостю не нужно махать рукой и ловить взгляд.
   */
  @Post('call-waiter')
  async callWaiter(@Body() dto: CallWaiterDto) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: dto.tableToken, isActive: true },
      include: { hall: { include: { location: true } } },
    });
    if (!table) throw new NotFoundException({ code: 'TABLE_NOT_FOUND' });

    await this.prisma.eventLog.create({
      data: {
        eventId: crypto.randomUUID(),
        accountId: table.hall.location.accountId,
        terminalId: null,
        type: 'guest.waiter_called',
        payload: { tableId: table.id, tableName: table.name },
      },
    }).catch(() => null);

    return { ok: true, tableName: table.name };
  }
}

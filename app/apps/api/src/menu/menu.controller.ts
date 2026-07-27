// apps/api/src/menu/menu.controller.ts
// Меню для кассы и бэк-офиса. Касса запрашивает каталог при открытии смены
// и дальше работает офлайн — поэтому отдаём всё одним ответом, а не
// постранично: 300 позиций в одном запросе дешевле, чем 30 запросов.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('menu')
@UseGuards(JwtGuard)
export class MenuController {
  constructor(private prisma: PrismaService) {}

  /**
   * Каталог для кассы: категории и товары одним ответом.
   * Цены берём с учётом точки: одно и то же блюдо на террасе и в зале
   * может стоить по-разному, и касса должна получить цену своей точки.
   */
  @Get('catalog')
  async catalog(@Query('locationId') locationId?: string) {
    const [categories, products, prices] = await Promise.all([
      this.prisma.menuCategory.findMany({
        where: { isDeleted: false },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.product.findMany({
        where: { isDeleted: false },
        select: {
          id: true, name: true, nameKk: true, categoryId: true, type: true,
          basePrice: true, unit: true, isWeighted: true, imageUrl: true,
        },
      }),
      locationId
        ? this.prisma.productPrice.findMany({ where: { locationId } })
        : Promise.resolve([] as any[]),
    ]);

    const priceByProduct = new Map(
      (prices as any[]).map((p) => [p.productId, p.price]),
    );

    return {
      categories: categories.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        nameKk: c.nameKk,
        color: c.color,
      })),
      products: products.map((p) => ({
        productId: p.id,
        name: p.name,
        nameKk: p.nameKk,
        categoryId: p.categoryId,
        type: p.type,
        price: priceByProduct.get(p.id) ?? p.basePrice,
        unit: p.unit,
        isWeighted: p.isWeighted,
        imageUrl: p.imageUrl,
      })),
    };
  }

  /**
   * Стоп-лист точки: что нельзя продавать прямо сейчас.
   * Отдельным запросом, потому что обновляется часто — блюдо кончается
   * в любой момент, а состав меню меняется раз в недели.
   */
  @Get('stop-list')
  async stopList(@Query('locationId') locationId: string) {
    const rows = await this.prisma.stopListEntry.findMany({
      where: { locationId },
      select: { productId: true, remainingQty: true, reason: true },
    });

    return rows.map((r) => ({
      productId: r.productId,
      // null = полный стоп без счётчика, число = осталось порций
      remaining: r.remainingQty === null ? null : Number(r.remainingQty),
      reason: r.reason,
    }));
  }

  /** Техкарта блюда: состав и выход. Нужна бэк-офису для расчёта себестоимости. */
  @Get('techcard')
  async techcard(@Query('productId') productId: string) {
    const card = await this.prisma.techCard.findFirst({
      where: { productId },
      orderBy: { version: 'desc' },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!card) return { productId, version: null, outputQty: 1, lines: [] };

    return {
      productId,
      version: card.version,
      outputQty: Number(card.outputQty),
      note: card.note,
      lines: card.lines.map((l) => ({
        componentId: l.componentId,
        brutto: Number(l.bruttoQty),
        netto: Number(l.nettoQty),
      })),
    };
  }
}

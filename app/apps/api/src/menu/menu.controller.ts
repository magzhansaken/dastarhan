// apps/api/src/menu/menu.controller.ts
// Меню для кассы и бэк-офиса. Касса запрашивает каталог при открытии смены
// и дальше работает офлайн — поэтому отдаём всё одним ответом, а не
// постранично: 300 позиций в одном запросе дешевле, чем 30 запросов.
import {
  Controller, Get, Post, Body, Query, UseGuards, Req,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

class TechCardLineDto {
  @IsString() componentId!: string;
  @IsNumber() @Min(0.0001) bruttoQty!: number;
  @IsOptional() @IsNumber() @Min(0) nettoQty?: number;
}

class SaveTechCardDto {
  @IsString() productId!: string;
  @IsNumber() @Min(0.001) outputQty!: number;
  @IsOptional() @IsString() note?: string;
  @IsArray() lines!: TechCardLineDto[];
}

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
        // Только то, что продаётся: блюда, товары и услуги.
        // Ингредиенты и полуфабрикаты нужны складу, но кассиру
        // на плитках они только мешают — их там быть не должно.
        where: { isDeleted: false, type: { in: ['DISH', 'GOODS', 'SERVICE'] } },
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

  /**
   * Расчёт себестоимости на лету — без сохранения.
   * Владелец меняет граммовку и сразу видит фудкост: плашка краснеет
   * ДО того, как блюдо попало в меню, а не через месяц в отчёте.
   */
  @Post('techcard/preview')
  @UseGuards(JwtGuard)
  async preview(@Body() dto: SaveTechCardDto, @Req() req: any) {
    const ids = dto.lines.map((l) => l.componentId);
    const [products, balances, target] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, unit: true },
      }),
      this.prisma.stockBalance.findMany({ where: { productId: { in: ids } } }),
      this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { basePrice: true, name: true },
      }),
    ]);

    const nameBy = new Map(products.map((p) => [p.id, p]));
    // Себестоимость по средней складской цене: это реальные деньги,
    // а не прайс поставщика, который может быть месячной давности
    const costBy = new Map(balances.map((b) => [b.productId, b.avgCost]));
    const qtyBy = new Map(balances.map((b) => [b.productId, Number(b.qty)]));

    let cost = 0;
    let minPortions = Infinity;
    let scarcest: string | null = null;

    const rows = dto.lines.map((l) => {
      const unitCost = costBy.get(l.componentId) ?? 0;
      const sum = Math.round(l.bruttoQty * unitCost);
      cost += sum;

      const have = qtyBy.get(l.componentId) ?? 0;
      const portions = l.bruttoQty > 0 ? Math.floor(have / l.bruttoQty) : Infinity;
      if (portions < minPortions) { minPortions = portions; scarcest = l.componentId; }

      return {
        componentId: l.componentId,
        name: nameBy.get(l.componentId)?.name ?? '—',
        unit: nameBy.get(l.componentId)?.unit ?? null,
        bruttoQty: l.bruttoQty,
        unitCost,
        sum,
        stockQty: have,
      };
    });

    const portionCost = dto.outputQty > 0 ? Math.round(cost / dto.outputQty) : cost;
    const price = target?.basePrice ?? 0;
    const foodCostPct = price > 0 ? +((portionCost / price) * 100).toFixed(1) : 0;

    return {
      lines: rows,
      totalCost: cost,
      portionCost,
      price,
      margin: price - portionCost,
      foodCostPct,
      // Цвет плашки: зелёный до 30%, жёлтый до 40%, красный дальше.
      // Норма общепита 25–35%, выше — блюдо не кормит бизнес
      foodCostLevel: foodCostPct <= 30 ? 'ok' : foodCostPct <= 40 ? 'warn' : 'danger',
      portionsLeft: minPortions === Infinity ? 0 : Math.max(0, minPortions),
      scarcestName: scarcest ? nameBy.get(scarcest)?.name ?? null : null,
    };
  }

  /** Сохранение техкарты новой версией. Старые чеки считаются по своей. */
  @Post('techcard')
  @UseGuards(JwtGuard)
  async saveTechCard(@Body() dto: SaveTechCardDto) {
    if (!dto.lines.length) throw new BadRequestException({ code: 'EMPTY_CARD' });

    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });

    const last = await this.prisma.techCard.findFirst({
      where: { productId: dto.productId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    // Новая версия, а не правка старой: чеки прошлого месяца должны
    // считаться по той карте, что действовала на момент продажи
    const card = await this.prisma.techCard.create({
      data: {
        productId: dto.productId,
        version: (last?.version ?? 0) + 1,
        effectiveFrom: new Date(),
        outputQty: dto.outputQty as any,
        note: dto.note ?? null,
        lines: {
          create: dto.lines.map((l, i) => ({
            componentId: l.componentId,
            bruttoQty: l.bruttoQty as any,
            nettoQty: (l.nettoQty ?? l.bruttoQty) as any,
            sortOrder: i,
          })),
        },
      },
      include: { lines: true },
    });

    return { ok: true, version: card.version, lines: card.lines.length };
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

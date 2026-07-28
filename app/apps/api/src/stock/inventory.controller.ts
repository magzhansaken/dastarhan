// apps/api/src/stock/inventory.controller.ts
// Инвентаризация без остановки продаж.
//
// Кладовщик считает два часа, за которые кафе продаёт половину
// холодильника. Если не учесть движения за это время, недостача
// будет фиктивной, и виноватыми окажутся невиновные.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class CountDto {
  @IsString() productId!: string;
  @IsNumber() @Min(0) factQty!: number;
}

@Controller('inventory')
@UseGuards(JwtGuard, PermissionsGuard)
export class InventoryController {
  constructor(private prisma: PrismaService) {}

  /**
   * Начать пересчёт. Фиксируем книжные остатки на этот момент —
   * дальше заведение работает как обычно.
   */
  @Post()
  @RequirePermission('stock.inventory')
  async start(
    @Body() dto: { warehouseId: string; note?: string; productIds?: string[] },
    @Req() req: any,
  ) {
    const open = await this.prisma.inventory.findFirst({
      where: { warehouseId: dto.warehouseId, status: 'COUNTING' },
    });
    if (open) {
      throw new BadRequestException({
        code: 'ALREADY_COUNTING',
        message: `Инвентаризация №${open.number} уже идёт — закончите её`,
      });
    }

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: dto.warehouseId,
        ...(dto.productIds?.length ? { productId: { in: dto.productIds } } : {}),
      },
    });

    const last = await this.prisma.inventory.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const inv = await this.prisma.inventory.create({
      data: {
        accountId: req.user.acc,
        warehouseId: dto.warehouseId,
        number: (last?.number ?? 0) + 1,
        createdBy: req.user.sub,
        note: dto.note ?? null,
        lines: {
          create: balances.map((b) => ({
            productId: b.productId,
            bookQty: b.qty,
            avgCost: b.avgCost,
          })),
        },
      },
      include: { lines: true },
    });

    return {
      inventoryId: inv.id,
      number: inv.number,
      startedAt: inv.startedAt,
      positions: inv.lines.length,
      hint: 'Продажи можно не останавливать — движения учтутся сами',
    };
  }

  /**
   * Лист пересчёта. Книжный остаток скрыт до ввода факта —
   * иначе кладовщик подгонит цифру под ожидание, и смысл
   * инвентаризации теряется.
   */
  @Get(':id/sheet')
  @RequirePermission('stock.inventory')
  async sheet(@Param('id') id: string, @Query('reveal') reveal?: string) {
    const inv = await this.prisma.inventory.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!inv) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND' });

    const products = await this.prisma.product.findMany({
      where: { id: { in: inv.lines.map((l) => l.productId) } },
      select: { id: true, name: true, unit: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Движения после старта: считаем один раз здесь, чтобы
    // кладовщик видел актуальную картину, не проводя документ
    const moves = await this.prisma.stockMovement.findMany({
      where: {
        warehouseId: inv.warehouseId,
        productId: { in: inv.lines.map((l) => l.productId) },
        at: { gte: inv.startedAt },
      },
      select: { productId: true, qtyDelta: true },
    });
    const movedBy = new Map<string, number>();
    for (const m of moves) {
      movedBy.set(m.productId, (movedBy.get(m.productId) ?? 0) + Number(m.qtyDelta));
    }

    const counted = inv.lines.filter((l) => l.factQty !== null).length;
    const showBook = reveal === 'true' || inv.status !== 'COUNTING';

    return {
      inventoryId: inv.id,
      number: inv.number,
      status: inv.status,
      startedAt: inv.startedAt,
      progress: { counted, total: inv.lines.length },
      // Слепой пересчёт: книжный остаток показываем только после
      // ввода факта или по явному запросу старшего
      blindMode: !showBook,
      rows: inv.lines.map((l) => {
        const p = byId.get(l.productId);
        const moved = movedBy.get(l.productId) ?? 0;
        const expected = Number(l.bookQty) + moved;
        const fact = l.factQty !== null ? Number(l.factQty) : null;
        const diff = fact !== null ? +(fact - expected).toFixed(3) : null;

        return {
          productId: l.productId,
          sku: p?.sku ?? null,
          name: p?.name ?? '—',
          unit: p?.unit ?? null,
          // Ожидаемый остаток = книжный на старте плюс движения
          expected: showBook || fact !== null ? +expected.toFixed(3) : null,
          movedSinceStart: +moved.toFixed(3),
          fact,
          diff,
          diffMoney: diff !== null ? Math.round(diff * l.avgCost) : null,
          counted: fact !== null,
        };
      }),
    };
  }

  /** Записать факт по позиции. */
  @Patch(':id/count')
  @RequirePermission('stock.inventory')
  async count(@Param('id') id: string, @Body() dto: CountDto, @Req() req: any) {
    const line = await this.prisma.inventoryLine.findFirst({
      where: { inventoryId: id, productId: dto.productId },
    });
    if (!line) throw new NotFoundException({ code: 'LINE_NOT_FOUND' });

    await this.prisma.inventoryLine.update({
      where: { id: line.id },
      data: {
        factQty: dto.factQty as any,
        countedBy: req.user.sub,
        countedAt: new Date(),
      },
    });

    return { ok: true, productId: dto.productId, factQty: dto.factQty };
  }

  /**
   * Провести: скорректировать остатки по факту.
   * Расхождения уходят в порчу и недостачи — там владелец их видит
   * отдельной строкой в отчёте о прибыли.
   */
  @Post(':id/post')
  @RequirePermission('stock.inventory')
  async post(@Param('id') id: string, @Req() req: any) {
    const inv = await this.prisma.inventory.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!inv) throw new NotFoundException({ code: 'INVENTORY_NOT_FOUND' });
    if (inv.status !== 'COUNTING') {
      throw new BadRequestException({ code: 'ALREADY_POSTED' });
    }

    const notCounted = inv.lines.filter((l) => l.factQty === null);
    if (notCounted.length) {
      throw new BadRequestException({
        code: 'NOT_ALL_COUNTED',
        message: `Не пересчитано позиций: ${notCounted.length}`,
        // Пустая строка и ноль — разные вещи. Если товара нет,
        // кладовщик должен явно записать ноль
        hint: 'Если товара нет на складе, запишите ноль — это не то же самое, что пропустить',
      });
    }

    const moves = await this.prisma.stockMovement.findMany({
      where: {
        warehouseId: inv.warehouseId,
        productId: { in: inv.lines.map((l) => l.productId) },
        at: { gte: inv.startedAt },
      },
      select: { productId: true, qtyDelta: true },
    });
    const movedBy = new Map<string, number>();
    for (const m of moves) {
      movedBy.set(m.productId, (movedBy.get(m.productId) ?? 0) + Number(m.qtyDelta));
    }

    let shortage = 0, surplus = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const l of inv.lines) {
        const moved = movedBy.get(l.productId) ?? 0;
        const expected = Number(l.bookQty) + moved;
        const fact = Number(l.factQty);
        const diff = fact - expected;
        if (Math.abs(diff) < 0.0001) continue;

        const money = Math.round(diff * l.avgCost);
        if (diff < 0) shortage += -money; else surplus += money;

        const bal = await tx.stockBalance.findFirst({
          where: { warehouseId: inv.warehouseId, productId: l.productId },
        });
        if (bal) {
          await tx.stockBalance.update({ where: { id: bal.id }, data: { qty: fact as any } });
        } else {
          await tx.stockBalance.create({
            data: {
              warehouseId: inv.warehouseId, productId: l.productId,
              qty: fact as any, avgCost: l.avgCost,
            },
          });
        }

        await tx.stockMovement.create({
          data: {
            accountId: inv.accountId,
            warehouseId: inv.warehouseId,
            productId: l.productId,
            qtyDelta: diff,
            unitCost: l.avgCost,
          },
        });

        await tx.inventoryLine.update({
          where: { id: l.id },
          data: { movedQty: moved as any },
        });
      }

      await tx.inventory.update({
        where: { id },
        data: { status: 'POSTED', finishedAt: new Date() },
      });
    });

    return {
      ok: true,
      number: inv.number,
      shortage,
      surplus,
      net: surplus - shortage,
      // Итог в деньгах и словами: «недостача 34 500 ₸» понятнее,
      // чем список килограммов
      verdict: shortage > surplus
        ? `Недостача ${Math.trunc((shortage - surplus) / 100).toLocaleString('ru-RU')} ₸`
        : surplus > shortage
        ? `Излишек ${Math.trunc((surplus - shortage) / 100).toLocaleString('ru-RU')} ₸`
        : 'Всё сошлось',
    };
  }

  /** История инвентаризаций — видно, растёт недостача или нет. */
  @Get()
  @RequirePermission('stock.inventory')
  async list(@Req() req: any) {
    const rows = await this.prisma.inventory.findMany({
      where: { accountId: req.user.acc },
      orderBy: { startedAt: 'desc' },
      take: 24,
      include: { lines: true },
    });

    return rows.map((inv) => {
      const diffs = inv.lines
        .filter((l) => l.factQty !== null)
        .map((l) => (Number(l.factQty) - Number(l.bookQty) - Number(l.movedQty)) * l.avgCost);
      const shortage = diffs.filter((d) => d < 0).reduce((s, d) => s + -d, 0);

      return {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        startedAt: inv.startedAt,
        finishedAt: inv.finishedAt,
        positions: inv.lines.length,
        shortage: Math.round(shortage),
        // Длительность пересчёта: если растёт, значит склад
        // запущен и позиций стало больше, чем успевают считать
        durationMin: inv.finishedAt
          ? Math.round((inv.finishedAt.getTime() - inv.startedAt.getTime()) / 60000) : null,
      };
    });
  }
}

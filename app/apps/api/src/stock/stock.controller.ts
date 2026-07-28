// apps/api/src/stock/stock.controller.ts
// Склад: остатки и документы. Вся арифметика уже в stock.logic и покрыта
// тестами — здесь только выборка и запись.
//
// Ключевое решение: остатки МОГУТ быть отрицательными и мы их не прячем.
// Минус означает «продали больше, чем оприходовали» — это сигнал о том,
// что забыли провести накладную. Скрыть его значит потерять деньги молча.
import {
  Body, Controller, Get, Post, Query, UseGuards, Req, Param,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class DocLineDto {
  @IsString() productId!: string;
  qty!: number;
  @IsOptional() unitCost?: number;
}

class CreateDocDto {
  @IsIn(['SUPPLY', 'WRITEOFF', 'TRANSFER', 'INVENTORY', 'PRODUCTION'])
  type!: 'SUPPLY' | 'WRITEOFF' | 'TRANSFER' | 'INVENTORY' | 'PRODUCTION';

  @IsString() warehouseId!: string;
  @IsOptional() @IsString() toWarehouseId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() note?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto)
  lines!: DocLineDto[];
}

@Controller('stock')
@UseGuards(JwtGuard, PermissionsGuard)
export class StockController {
  constructor(private prisma: PrismaService) {}

  /** Остатки склада. Отрицательные показываем как есть — это сигнал, а не ошибка. */
  @Get('balances')
  @RequirePermission('stock.supply')
  async balances(@Query('warehouseId') warehouseId?: string) {
    const rows = await this.prisma.stockBalance.findMany({
      where: warehouseId ? { warehouseId } : {},
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return rows.map((r) => ({
      productId: r.productId,
      name: byId.get(r.productId)?.name ?? '—',
      unit: byId.get(r.productId)?.unit ?? 'PCS',
      qty: Number(r.qty),
      avgCost: r.avgCost,
      value: Math.round(Number(r.qty) * r.avgCost),
      isNegative: Number(r.qty) < 0,
    }));
  }

  /** Список документов склада: приходы, списания, инвентаризации. */
  @Get('docs')
  @RequirePermission('stock.supply')
  async docs(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('locationId') locationId?: string,
  ) {
    const docs = await this.prisma.stockDoc.findMany({
      where: {
        ...(type ? { type: type as any } : {}),
        ...(status ? { status: status as any } : {}),
        ...(locationId ? { locationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { lines: true },
    });

    return docs.map((d) => ({
      id: d.id,
      type: d.type,
      status: d.status,
      number: d.number,
      warehouseId: d.warehouseId,
      createdAt: d.createdAt,
      postedAt: d.postedAt,
      linesCount: d.lines.length,
      total: d.lines.reduce((s, l) => s + Number(l.qty) * (l.unitCost ?? 0), 0),
    }));
  }

  /**
   * Создание документа. Всегда в статусе DRAFT — проведение отдельным
   * действием, чтобы кладовщик мог сохранить наполовину заполненную
   * накладную и вернуться к ней, не двигая остатки.
   */
  @Post('docs')
  @RequirePermission('stock.supply')
  async createDoc(@Body() dto: CreateDocDto, @Req() req: any) {
    const accountId = req.user.acc;
    const locationId = req.user.loc ?? null;

    // Номер документа в рамках аккаунта: сквозная нумерация упрощает
    // разговор с бухгалтерией — «накладная 412» однозначна
    const last = await this.prisma.stockDoc.findFirst({
      where: { accountId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const doc = await this.prisma.stockDoc.create({
      data: {
        accountId,
        locationId: locationId ?? '',
        type: dto.type as any,
        status: 'DRAFT',
        number: (last?.number ?? 0) + 1,
        warehouseId: dto.warehouseId,
        toWarehouseId: dto.toWarehouseId ?? null,
        supplierId: dto.supplierId ?? null,
        reason: dto.reason ?? null,
        note: dto.note ?? null,
        createdBy: req.user.sub,
        ...(dto.type === 'INVENTORY' ? { countStartedAt: new Date() } : {}),
        lines: {
          create: dto.lines.map((l, i) => ({
            productId: l.productId,
            qty: l.qty as any,
            unitCost: l.unitCost ?? 0,
            sortOrder: i,
          })),
        },
      },
      include: { lines: true },
    });

    return { id: doc.id, number: doc.number, status: doc.status, lines: doc.lines.length };
  }

  /**
   * Проведение документа: только здесь двигаются остатки.
   * До проведения документ — черновик, кладовщик может править его сколько
   * угодно. Это защита от половины накладной, случайно улетевшей в учёт.
   */
  @Post('docs/:id/post')
  @RequirePermission('stock.supply')
  async postDoc(@Param('id') id: string, @Req() req: any) {
    const doc = await this.prisma.stockDoc.findFirst({
      where: { id, accountId: req.user.acc },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundException({ code: 'DOC_NOT_FOUND' });
    if (doc.status === 'POSTED') return { alreadyPosted: true, id: doc.id };
    if (doc.status === 'VOIDED') throw new BadRequestException({ code: 'DOC_VOIDED' });
    if (!doc.lines.length) throw new BadRequestException({ code: 'DOC_EMPTY' });

    // Знак движения зависит от типа: приход добавляет, списание убирает
    const sign = doc.type === 'SUPPLY' || doc.type === 'SURPLUS' || doc.type === 'PRODUCTION'
      ? 1 : -1;

    await this.prisma.$transaction(async (tx) => {
      for (const line of doc.lines) {
        const qty = Number(line.qty);
        if (qty <= 0) continue;

        const bal = await tx.stockBalance.findFirst({
          where: { warehouseId: doc.warehouseId, productId: line.productId },
        });
        const curQty = bal ? Number(bal.qty) : 0;
        const curAvg = bal?.avgCost ?? 0;
        const nextQty = curQty + sign * qty;

        // Скользящая средневзвешенная. При минусовом остатке средняя
        // сбрасывается на цену прихода: иначе минус отравляет расчёт
        // себестоимости на месяцы вперёд
        let nextAvg = curAvg;
        if (sign > 0) {
          nextAvg = curQty <= 0
            ? (line.unitCost ?? 0)
            : Math.round((curQty * curAvg + qty * (line.unitCost ?? 0)) / (curQty + qty));
        }

        if (bal) {
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: { qty: nextQty, avgCost: nextAvg },
          });
        } else {
          await tx.stockBalance.create({
            data: {
              warehouseId: doc.warehouseId,
              productId: line.productId,
              qty: nextQty,
              avgCost: nextAvg,
            },
          });
        }

        await tx.stockMovement.create({
          data: {
            accountId: doc.accountId,
            warehouseId: doc.warehouseId,
            productId: line.productId,
            docId: doc.id,
            qtyDelta: sign * qty,
            unitCost: line.unitCost ?? curAvg,
          },
        });
      }

      await tx.stockDoc.update({
        where: { id: doc.id },
        data: { status: 'POSTED', postedAt: new Date() },
      });
    });

    return { posted: true, id: doc.id, lines: doc.lines.length, type: doc.type };
  }

  /** Открытая смена точки — касса спрашивает при старте. */
  @Get('shift/current')
  @RequirePermission('cash.shift.open')
  async currentShift(@Query('terminalId') terminalId: string) {
    const shift = await this.prisma.cashShift.findFirst({
      where: { terminalId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });

    if (!shift) return { open: false };

    return {
      open: true,
      id: shift.id,
      number: shift.number,
      openedAt: shift.openedAt,
      openingCash: shift.openingCash,
    };
  }
}

// apps/api/src/stock/supply.controller.ts
// Поставщики, минимальные остатки и заявки.
//
// Связка решает главную проблему: заведение не должно узнавать
// о нехватке продуктов от гостя, которому не смогли подать блюдо.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class SupplierDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() binIin?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsInt() @Min(0) deferDays?: number;
}

class LimitDto {
  @IsString() warehouseId!: string;
  @IsString() productId!: string;
  @IsNumber() @Min(0) minQty!: number;
  @IsOptional() @IsNumber() @Min(0) maxQty?: number;
  @IsOptional() @IsString() supplierId?: string;
}

class RequestLineDto {
  @IsString() productId!: string;
  @IsNumber() @Min(0.001) qty!: number;
}

class CreateRequestDto {
  @IsString() locationId!: string;
  @IsString() supplierId!: string;
  @IsOptional() @IsString() expectedAt?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() lines!: RequestLineDto[];
}

@Controller('supply')
@UseGuards(JwtGuard, PermissionsGuard)
export class SupplyController {
  constructor(private prisma: PrismaService) {}

  // ═══════════════ ПОСТАВЩИКИ ═══════════════

  @Get('suppliers')
  @RequirePermission('stock.supply')
  async suppliers(@Req() req: any, @Query('q') q?: string) {
    const rows = await this.prisma.supplier.findMany({
      where: {
        accountId: req.user.acc,
        isActive: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
    });

    // Сумма закупок и дата последней: видно, кто основной поставщик,
    // а кто разовый — при переговорах о скидке это аргумент
    const out = [];
    for (const s of rows) {
      const docs = await this.prisma.stockDoc.findMany({
        where: { supplierId: s.id, status: 'POSTED' },
        include: { lines: true },
        orderBy: { postedAt: 'desc' },
        take: 100,
      });
      const total = docs.reduce(
        (sum, d) => sum + d.lines.reduce((s2, l) => s2 + Number(l.qty) * (l.unitCost ?? 0), 0), 0);

      out.push({
        id: s.id, name: s.name, binIin: s.binIin, phone: s.phone,
        contact: s.contact, category: s.category, deferDays: s.deferDays,
        docsCount: docs.length,
        totalBought: total,
        lastDeliveryAt: docs[0]?.postedAt ?? null,
      });
    }
    return out;
  }

  @Post('suppliers')
  @RequirePermission('stock.supply')
  async createSupplier(@Body() dto: SupplierDto, @Req() req: any) {
    const s = await this.prisma.supplier.create({
      data: {
        accountId: req.user.acc,
        name: dto.name.trim(),
        binIin: dto.binIin?.replace(/\D/g, '') || null,
        phone: dto.phone?.trim() || null,
        contact: dto.contact?.trim() || null,
        category: dto.category?.trim() || null,
        deferDays: dto.deferDays ?? 0,
      },
    });
    return { id: s.id, name: s.name };
  }

  // ═══════════════ МИНИМАЛЬНЫЕ ОСТАТКИ ═══════════════

  /**
   * Что пора заказывать. Главный экран кладовщика утром:
   * не список остатков, а список действий.
   */
  @Get('to-order')
  @RequirePermission('stock.supply')
  async toOrder(@Query('warehouseId') warehouseId: string) {
    const limits = await this.prisma.stockLimit.findMany({
      where: warehouseId ? { warehouseId } : {},
    });
    if (!limits.length) return { rows: [], note: 'Минимальные остатки не заданы' };

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: warehouseId || undefined,
        productId: { in: limits.map((l) => l.productId) },
      },
    });
    const balBy = new Map(balances.map((b) => [b.productId, b]));

    const products = await this.prisma.product.findMany({
      where: { id: { in: limits.map((l) => l.productId) } },
      select: { id: true, name: true, unit: true },
    });
    const prodBy = new Map(products.map((p) => [p.id, p]));

    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: limits.map((l) => l.supplierId).filter(Boolean) as string[] } },
      select: { id: true, name: true, phone: true },
    });
    const supBy = new Map(suppliers.map((s) => [s.id, s]));

    const rows = [];
    for (const l of limits) {
      const bal = balBy.get(l.productId);
      const have = bal ? Number(bal.qty) : 0;
      const min = Number(l.minQty);
      if (have > min) continue;

      const p = prodBy.get(l.productId);
      const sup = l.supplierId ? supBy.get(l.supplierId) : null;
      // Заказываем до максимума, а если он не задан — двойной минимум.
      // Заказ «ровно до минимума» бессмыслен: на следующий день опять ноль
      const target = l.maxQty ? Number(l.maxQty) : min * 2;

      rows.push({
        productId: l.productId,
        name: p?.name ?? '—',
        unit: p?.unit ?? null,
        have,
        min,
        needQty: +(target - have).toFixed(3),
        supplierId: sup?.id ?? null,
        supplierName: sup?.name ?? null,
        supplierPhone: sup?.phone ?? null,
        // Минус — не «скоро кончится», а «уже продаём в долг»
        critical: have <= 0,
      });
    }

    rows.sort((a, b) => (a.critical === b.critical ? a.have - b.have : a.critical ? -1 : 1));
    return {
      rows,
      criticalCount: rows.filter((r) => r.critical).length,
      note: rows.length
        ? `Пора заказать ${rows.length} позиций`
        : 'Всё в порядке — запасов хватает',
    };
  }

  @Post('limits')
  @RequirePermission('stock.supply')
  async setLimit(@Body() dto: LimitDto) {
    if (dto.maxQty != null && dto.maxQty <= dto.minQty) {
      throw new BadRequestException({
        code: 'BAD_LIMITS',
        message: 'Максимум должен быть больше минимума',
      });
    }
    const row = await this.prisma.stockLimit.upsert({
      where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } },
      update: {
        minQty: dto.minQty as any,
        maxQty: (dto.maxQty ?? null) as any,
        supplierId: dto.supplierId ?? null,
      },
      create: {
        warehouseId: dto.warehouseId,
        productId: dto.productId,
        minQty: dto.minQty as any,
        maxQty: (dto.maxQty ?? null) as any,
        supplierId: dto.supplierId ?? null,
      },
    });
    return { ok: true, id: row.id };
  }

  // ═══════════════ ЗАЯВКИ ПОСТАВЩИКУ ═══════════════

  /**
   * Заявка из списка «пора заказать»: кладовщик не переписывает
   * позиции вручную, а отправляет то, что система уже посчитала.
   */
  @Post('requests')
  @RequirePermission('stock.supply')
  async createRequest(@Body() dto: CreateRequestDto, @Req() req: any) {
    if (!dto.lines.length) throw new BadRequestException({ code: 'EMPTY_REQUEST' });

    const last = await this.prisma.supplyRequest.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const r = await this.prisma.supplyRequest.create({
      data: {
        accountId: req.user.acc,
        locationId: dto.locationId,
        supplierId: dto.supplierId,
        number: (last?.number ?? 0) + 1,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        note: dto.note ?? null,
        createdBy: req.user.sub,
        lines: { create: dto.lines.map((l) => ({ productId: l.productId, qty: l.qty as any })) },
      },
      include: { lines: true, supplier: true },
    });

    return { id: r.id, number: r.number, lines: r.lines.length, supplier: r.supplier.name };
  }

  @Get('requests')
  @RequirePermission('stock.supply')
  async requests(@Req() req: any, @Query('status') status?: string) {
    const rows = await this.prisma.supplyRequest.findMany({
      where: { accountId: req.user.acc, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { supplier: { select: { name: true, phone: true } }, lines: true },
    });

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      supplierName: r.supplier.name,
      supplierPhone: r.supplier.phone,
      linesCount: r.lines.length,
      expectedAt: r.expectedAt,
      // Просрочка привоза: поставщик обещал вчера, а товара нет —
      // повод звонить сейчас, а не когда блюдо кончится
      overdue: r.expectedAt ? r.expectedAt.getTime() < now && r.status === 'SENT' : false,
      createdAt: r.createdAt,
    }));
  }

  /** Отправить заявку: фиксируем время, дальше ждём привоз. */
  @Patch('requests/:id/send')
  @RequirePermission('stock.supply')
  async sendRequest(@Param('id') id: string) {
    const r = await this.prisma.supplyRequest.findUnique({
      where: { id }, include: { supplier: true, lines: true },
    });
    if (!r) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });

    await this.prisma.supplyRequest.update({
      where: { id }, data: { status: 'SENT', sentAt: new Date() },
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: r.lines.map((l) => l.productId) } },
      select: { id: true, name: true, unit: true },
    });
    const nameBy = new Map(products.map((p) => [p.id, p]));

    // Готовый текст для WhatsApp: кладовщик копирует и отправляет,
    // не переписывая позиции руками
    const text = [
      `Заявка №${r.number}`,
      ...r.lines.map((l) => {
        const p = nameBy.get(l.productId);
        return `${p?.name ?? '—'} — ${Number(l.qty)} ${p?.unit === 'KG' ? 'кг' : p?.unit === 'L' ? 'л' : 'шт'}`;
      }),
      r.expectedAt ? `Нужно к ${r.expectedAt.toLocaleDateString('ru-RU')}` : '',
    ].filter(Boolean).join('\n');

    return {
      ok: true,
      whatsappText: text,
      whatsappUrl: r.supplier.phone
        ? `https://wa.me/${r.supplier.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
        : null,
    };
  }
}

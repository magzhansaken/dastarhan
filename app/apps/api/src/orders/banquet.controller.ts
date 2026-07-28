// apps/api/src/orders/banquet.controller.ts
// Банкеты: свадьбы, юбилеи, корпоративы.
//
// Самый дорогой заказ заведения и самый рискованный. Зал занят
// на вечер, продукты закуплены под конкретное меню — если гость
// не придёт, потери не покроет обычная выручка.
//
// Поэтому три правила: предоплата обязательна, кухня знает список
// закупок заранее, отмена ближе срока стоит дороже.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class BanquetDto {
  @IsString() locationId!: string;
  @IsString() @Length(2, 80) title!: string;
  @IsString() @Length(2, 80) guestName!: string;
  @IsString() phone!: string;
  @IsInt() @Min(1) guestsCount!: number;
  @IsString() startAt!: string;
  @IsOptional() @IsInt() durationMin?: number;
  @IsOptional() @IsString() hallId?: string;
  @IsOptional() tableIds?: string[];
  @IsOptional() @IsInt() servicePct?: number;
  @IsOptional() @IsString() comment?: string;
  @IsArray() items!: { productId: string; qty: number; course?: number; comment?: string }[];
}

@Controller('banquets')
@UseGuards(JwtGuard, PermissionsGuard)
export class BanquetController {
  constructor(private prisma: PrismaService) {}

  @Post()
  @RequirePermission('order.create')
  async create(@Body() dto: BanquetDto, @Req() req: any) {
    const startAt = new Date(dto.startAt);
    if (startAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'PAST_DATE',
        message: 'Дата в прошлом — проверьте, что вводите',
      });
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((i) => i.productId) } },
      select: { id: true, name: true, basePrice: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const subtotal = dto.items.reduce((s, i) => {
      const p = byId.get(i.productId);
      return s + (p?.basePrice ?? 0) * i.qty;
    }, 0);
    const service = Math.round(subtotal * (dto.servicePct ?? 0) / 100);

    const last = await this.prisma.banquet.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const b = await this.prisma.banquet.create({
      data: {
        accountId: req.user.acc,
        locationId: dto.locationId,
        number: (last?.number ?? 0) + 1,
        title: dto.title.trim(),
        guestName: dto.guestName.trim(),
        phone: dto.phone.trim(),
        guestsCount: dto.guestsCount,
        startAt,
        durationMin: dto.durationMin ?? 240,
        hallId: dto.hallId ?? null,
        tableIds: dto.tableIds ?? [],
        servicePct: dto.servicePct ?? 0,
        total: subtotal + service,
        managerId: req.user.sub,
        comment: dto.comment ?? null,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            name: byId.get(i.productId)?.name ?? '—',
            qty: i.qty as any,
            unitPrice: byId.get(i.productId)?.basePrice ?? 0,
            course: i.course ?? 1,
            comment: i.comment ?? null,
          })),
        },
      },
      include: { items: true },
    });

    const perGuest = Math.round((subtotal + service) / dto.guestsCount);

    return {
      banquetId: b.id,
      number: b.number,
      subtotal,
      service,
      total: b.total,
      // Цена на человека — то, о чём спрашивают первым делом
      perGuest,
      // Рекомендуемая предоплата: треть покрывает закупку продуктов
      recommendedPrepay: Math.round(b.total * 0.3),
      hint: 'Банкет не подтверждён — внесите предоплату, чтобы закрепить зал',
    };
  }

  /**
   * Подтвердить банкет предоплатой.
   * Без денег зал не держим: обещание словом стоит потерянного вечера.
   */
  @Patch(':id/prepay')
  @RequirePermission('order.create')
  async prepay(
    @Param('id') id: string,
    @Body() dto: { amount: number; method: string },
    @Req() req: any,
  ) {
    const b = await this.prisma.banquet.findUnique({ where: { id } });
    if (!b) throw new NotFoundException({ code: 'BANQUET_NOT_FOUND' });
    if (b.status === 'CANCELLED') {
      throw new BadRequestException({ code: 'CANCELLED' });
    }

    const total = b.prepaid + dto.amount;
    const minPrepay = Math.round(b.total * 0.2);

    await this.prisma.banquet.update({
      where: { id },
      data: {
        prepaid: total,
        prepaidAt: new Date(),
        status: total >= minPrepay ? 'CONFIRMED' : b.status,
        confirmedAt: total >= minPrepay ? new Date() : b.confirmedAt,
      },
    });

    return {
      ok: true,
      prepaid: total,
      remaining: b.total - total,
      confirmed: total >= minPrepay,
      message: total >= minPrepay
        ? 'Банкет подтверждён — зал закреплён'
        : `Нужно минимум ${Math.trunc(minPrepay / 100).toLocaleString('ru-RU')} ₸ для подтверждения`,
    };
  }

  /**
   * Список закупок под банкет: что нужно купить и когда.
   *
   * Считаем по техкартам с учётом того, что уже есть на складе.
   * Без этого шеф закупает на глаз и либо тратит лишнее,
   * либо в день банкета обнаруживает нехватку.
   */
  @Get(':id/shopping-list')
  @RequirePermission('stock.supply')
  async shoppingList(@Param('id') id: string) {
    const b = await this.prisma.banquet.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!b) throw new NotFoundException({ code: 'BANQUET_NOT_FOUND' });

    const cards = await this.prisma.techCard.findMany({
      where: { productId: { in: b.items.map((i) => i.productId) } },
      include: { lines: true },
      orderBy: { version: 'desc' },
    });
    const cardBy = new Map<string, typeof cards[0]>();
    for (const c of cards) if (!cardBy.has(c.productId)) cardBy.set(c.productId, c);

    // Сколько сырья нужно всего
    const need = new Map<string, number>();
    const noCard: string[] = [];
    for (const item of b.items) {
      const card = cardBy.get(item.productId);
      if (!card) { noCard.push(item.name); continue; }
      for (const l of card.lines) {
        const qty = Number(l.bruttoQty) * Number(item.qty);
        need.set(l.componentId, (need.get(l.componentId) ?? 0) + qty);
      }
    }

    const wh = await this.prisma.warehouse.findFirst({
      where: { locationId: b.locationId, isActive: true },
      orderBy: { isDefault: 'desc' },
    });
    const balances = wh ? await this.prisma.stockBalance.findMany({
      where: { warehouseId: wh.id, productId: { in: [...need.keys()] } },
    }) : [];
    const haveBy = new Map(balances.map((x) => [x.productId, Number(x.qty)]));

    const products = await this.prisma.product.findMany({
      where: { id: { in: [...need.keys()] } },
      select: { id: true, name: true, unit: true },
    });
    const prodBy = new Map(products.map((p) => [p.id, p]));

    const rows = [...need.entries()].map(([productId, qty]) => {
      const have = haveBy.get(productId) ?? 0;
      const p = prodBy.get(productId);
      // Запас десять процентов: усушка, ошибки порционирования,
      // добавка от гостей. Дешевле купить лишнее, чем сорвать банкет
      const withReserve = qty * 1.1;
      return {
        productId,
        name: p?.name ?? '—',
        unit: p?.unit ?? null,
        needQty: +qty.toFixed(3),
        withReserve: +withReserve.toFixed(3),
        haveQty: +have.toFixed(3),
        toBuy: +Math.max(0, withReserve - have).toFixed(3),
      };
    }).filter((r) => r.toBuy > 0).sort((a, b2) => b2.toBuy - a.toBuy);

    const daysLeft = Math.ceil((b.startAt.getTime() - Date.now()) / 86400_000);

    return {
      banquetId: b.id,
      title: b.title,
      startAt: b.startAt,
      daysLeft,
      guestsCount: b.guestsCount,
      rows,
      noTechCard: noCard,
      // Скоропортящееся покупают накануне, крупы заранее —
      // напоминаем, когда пора начинать
      hint: daysLeft <= 1
        ? 'Банкет завтра — закупка должна быть готова'
        : daysLeft <= 3
        ? 'Пора закупать скоропортящееся'
        : `До банкета ${daysLeft} дней — закупите крупы и консервы`,
      warning: noCard.length
        ? `Без техкарты: ${noCard.join(', ')} — рассчитайте вручную`
        : null,
    };
  }

  /** Календарь банкетов: что и когда, чтобы не поставить два на один зал. */
  @Get()
  @RequirePermission('order.create')
  async list(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('days') days = '30',
  ) {
    const fromDate = from ? new Date(from) : new Date();
    const toDate = new Date(fromDate);
    toDate.setDate(toDate.getDate() + Number(days));

    const rows = await this.prisma.banquet.findMany({
      where: {
        accountId: req.user.acc,
        startAt: { gte: fromDate, lte: toDate },
        status: { not: 'CANCELLED' },
      },
      orderBy: { startAt: 'asc' },
      include: { items: true },
    });

    const now = Date.now();
    return rows.map((b) => {
      const daysLeft = Math.ceil((b.startAt.getTime() - now) / 86400_000);
      return {
        id: b.id,
        number: b.number,
        title: b.title,
        guestName: b.guestName,
        phone: b.phone,
        guestsCount: b.guestsCount,
        startAt: b.startAt,
        daysLeft,
        status: b.status,
        total: b.total,
        prepaid: b.prepaid,
        remaining: b.total - b.prepaid,
        itemsCount: b.items.length,
        // Неподтверждённый банкет за три дня — повод звонить:
        // зал держим, а денег нет
        needsCall: b.status === 'DRAFT' && daysLeft <= 3,
        callReason: b.status === 'DRAFT' && daysLeft <= 3
          ? `Через ${daysLeft} дн., предоплаты нет — уточните, состоится ли`
          : null,
      };
    });
  }
}

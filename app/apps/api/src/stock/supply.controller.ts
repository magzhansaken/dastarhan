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
    const out: any[] = [];
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
    const balBy = new Map(balances.map((b) => [b.productId, b] as const));

    const products = await this.prisma.product.findMany({
      where: { id: { in: limits.map((l) => l.productId) } },
      select: { id: true, name: true, unit: true },
    });
    const prodBy = new Map(products.map((p) => [p.id, p] as const));

    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: limits.map((l) => l.supplierId).filter(Boolean) as string[] } },
      select: { id: true, name: true, phone: true },
    });
    const supBy = new Map(suppliers.map((s) => [s.id, s] as const));

    const rows: any[] = [];
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
    const nameBy = new Map(products.map((p) => [p.id, p] as const));

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

  // ═══════════════ АКТ СВЕРКИ ═══════════════

  /**
   * Сверка с поставщиком: кто кому должен.
   * Раз в месяц поставщик присылает свою цифру, и она не сходится
   * с нашей. Без акта спор упирается в «а я помню иначе».
   */
  @Get('reconciliation')
  @RequirePermission('finance.view')
  async reconciliation(
    @Query('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException({ code: 'SUPPLIER_NOT_FOUND' });

    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400_000);
    const toDate = to ? new Date(to) : new Date();

    const docs = await this.prisma.stockDoc.findMany({
      where: {
        supplierId,
        status: 'POSTED',
        postedAt: { gte: fromDate, lte: toDate },
      },
      include: { lines: true },
      orderBy: { postedAt: 'asc' },
    });

    // Платежи поставщику: расход по статье закупок с привязкой к документу
    const payments = await this.prisma.finTransaction.findMany({
      where: {
        supplyDocId: { in: docs.map((d) => d.id) },
        at: { gte: fromDate, lte: toDate },
      },
      select: { supplyDocId: true, amount: true, at: true },
    });
    const paidBy = new Map<string, number>();
    for (const p of payments) {
      if (!p.supplyDocId) continue;
      paidBy.set(p.supplyDocId, (paidBy.get(p.supplyDocId) ?? 0) + Math.abs(p.amount));
    }

    const now = Date.now();
    let totalReceived = 0;
    let totalPaid = 0;

    const rows = docs.map((d) => {
      const sum = d.lines.reduce((s, l) => s + Number(l.qty) * (l.unitCost ?? 0), 0);
      const paid = paidBy.get(d.id) ?? 0;
      totalReceived += sum;
      totalPaid += paid;

      // Срок оплаты по отсрочке из договора: видно, что просрочено,
      // а что ещё в рамках договорённостей
      const due = d.postedAt
        ? new Date(d.postedAt.getTime() + supplier.deferDays * 86400_000)
        : null;

      return {
        docId: d.id,
        number: d.number,
        type: d.type,
        at: d.postedAt,
        sum,
        paid,
        debt: sum - paid,
        dueAt: due,
        overdue: !!due && sum > paid && due.getTime() < now,
        overdueDays: due && sum > paid && due.getTime() < now
          ? Math.floor((now - due.getTime()) / 86400_000) : 0,
      };
    });

    const debt = totalReceived - totalPaid;
    const overdueSum = rows.filter((r) => r.overdue).reduce((s, r) => s + r.debt, 0);

    return {
      supplier: {
        id: supplier.id, name: supplier.name,
        binIin: supplier.binIin, phone: supplier.phone,
        deferDays: supplier.deferDays,
      },
      period: { from: fromDate, to: toDate },
      totalReceived,
      totalPaid,
      debt,
      overdueSum,
      // Формулировка на языке бухгалтера: «сальдо» понятно обеим сторонам
      verdict: debt > 0
        ? `Мы должны ${Math.trunc(debt / 100).toLocaleString('ru-RU')} ₸`
        : debt < 0
        ? `Переплата ${Math.trunc(-debt / 100).toLocaleString('ru-RU')} ₸`
        : 'Расчёты закрыты',
      rows,
    };
  }

  /** Долги по всем поставщикам — что платить в первую очередь. */
  @Get('debts')
  @RequirePermission('finance.view')
  async debts(@Req() req: any) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { accountId: req.user.acc, isActive: true },
    });

    const out: any[] = [];
    for (const s of suppliers) {
      const r = await this.reconciliation(s.id).catch(() => null);
      if (!r || r.debt <= 0) continue;
      out.push({
        supplierId: s.id,
        name: s.name,
        phone: s.phone,
        debt: r.debt,
        overdueSum: r.overdueSum,
        // Просроченный долг платим первым: за него портятся отношения
        // и могут перестать отгружать
        priority: r.overdueSum > 0 ? 'high' : 'normal',
      });
    }

    out.sort((a, b) => b.overdueSum - a.overdueSum || b.debt - a.debt);
    return {
      totalDebt: out.reduce((s, x) => s + x.debt, 0),
      overdueTotal: out.reduce((s, x) => s + x.overdueSum, 0),
      rows: out,
    };
  }

  /**
   * Рекомендация закупки на основе продаж. Владелец не задаёт
   * минимумы руками — система считает по фактическому расходу.
   *
   * У iiko это «Рекомендуем заказать» на неделю. Мы идём дальше:
   * учитываем день недели и срок поставки, потому что расход
   * в пятницу и во вторник отличается вдвое.
   */
  @Get('recommend')
  @RequirePermission('stock.supply')
  async recommend(
    @Req() req: any,
    @Query('warehouseId') warehouseId: string,
    @Query('days') coverDays = '7',
  ) {
    const cover = Number(coverDays) || 7;
    const from = new Date();
    from.setDate(from.getDate() - 28);   // четыре недели — сглаживает случайные всплески

    const moves = await this.prisma.stockMovement.findMany({
      where: {
        accountId: req.user.acc,
        warehouseId: warehouseId || undefined,
        qtyDelta: { lt: 0 },
        at: { gte: from },
      },
      select: { productId: true, qtyDelta: true, at: true },
    });

    if (!moves.length) {
      return { rows: [], note: 'Мало данных — рекомендации появятся через неделю продаж' };
    }

    // Расход по дням недели: в пятницу расходится вдвое больше,
    // чем во вторник, и средний по неделе врёт для обоих
    const byProduct = new Map<string, { total: number; byDow: number[]; days: Set<string> }>();
    for (const m of moves) {
      const cur = byProduct.get(m.productId) ?? {
        total: 0, byDow: Array(7).fill(0), days: new Set<string>(),
      };
      const qty = Math.abs(Number(m.qtyDelta));
      cur.total += qty;
      cur.byDow[(m.at.getDay() + 6) % 7] += qty;   // 0 = понедельник
      cur.days.add(m.at.toISOString().slice(0, 10));
      byProduct.set(m.productId, cur);
    }

    const [balances, products, limits] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { warehouseId: warehouseId || undefined, productId: { in: [...byProduct.keys()] } },
      }),
      this.prisma.product.findMany({
        where: { id: { in: [...byProduct.keys()] } },
        select: { id: true, name: true, unit: true },
      }),
      this.prisma.stockLimit.findMany({
        where: { warehouseId: warehouseId || undefined },
      }),
    ]);

    const balBy = new Map(balances.map((b) => [b.productId, Number(b.qty)] as const));
    const prodBy = new Map(products.map((p) => [p.id, p] as const));
    const supBy = new Map(limits.map((l) => [l.productId, l.supplierId] as const));

    const rows: any[] = [];
    for (const [productId, v] of byProduct) {
      const activeDays = Math.max(1, v.days.size);
      const perDay = v.total / activeDays;
      const have = balBy.get(productId) ?? 0;

      // Пиковый день недели: если расход неровный, ориентируемся
      // на худший случай, иначе кончится в субботу вечером
      const peakDow = Math.max(...v.byDow) / Math.max(1, activeDays / 7);
      const daily = Math.max(perDay, peakDow / 7);

      const need = daily * cover - have;
      const daysLeft = daily > 0 ? Math.floor(have / daily) : 999;

      if (need <= 0 && daysLeft > cover) continue;

      const p = prodBy.get(productId);
      rows.push({
        productId,
        name: p?.name ?? '—',
        unit: p?.unit ?? null,
        have: +have.toFixed(3),
        dailyUse: +daily.toFixed(3),
        // Дней до нуля — понятнее, чем «остаток 1.2 кг»:
        // владелец сразу знает, успеет ли заказать
        daysLeft: daysLeft > 99 ? null : daysLeft,
        recommend: +Math.max(0, need).toFixed(3),
        supplierId: supBy.get(productId) ?? null,
        urgent: daysLeft <= 2,
      });
    }

    rows.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

    return {
      coverDays: cover,
      basedOn: 'расход за 4 недели с учётом дня недели',
      urgentCount: rows.filter((r) => r.urgent).length,
      rows,
      note: rows.length
        ? `${rows.length} позиций закончатся в ближайшие ${cover} дней`
        : 'Запасов хватает',
    };
  }

  /**
   * Приёмка по заявке: сверяем заказанное с привезённым.
   *
   * Поставщик привозит не то, что заказали, и это норма рынка.
   * Кладовщик подписывает накладную не глядя, а через месяц
   * владелец видит, что платит за товар, которого не было.
   */
  @Get('requests/:id/receive-sheet')
  @RequirePermission('stock.supply')
  async receiveSheet(@Param('id') id: string) {
    const req = await this.prisma.supplyRequest.findUnique({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (!req) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });

    const products = await this.prisma.product.findMany({
      where: { id: { in: req.lines.map((l) => l.productId) } },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(products.map((p) => [p.id, p] as const));

    // Прошлые цены: кладовщик должен заметить подорожание
    // в момент приёмки, а не через месяц в отчёте
    const lastPrices = new Map<string, number>();
    for (const l of req.lines) {
      const move = await this.prisma.stockMovement.findFirst({
        where: { productId: l.productId, qtyDelta: { gt: 0 } },
        orderBy: { at: 'desc' },
        select: { unitCost: true },
      });
      if (move) lastPrices.set(l.productId, move.unitCost);
    }

    return {
      requestId: req.id,
      number: req.number,
      supplier: { name: req.supplier.name, phone: req.supplier.phone },
      expectedAt: req.expectedAt,
      rows: req.lines.map((l) => {
        const p = byId.get(l.productId);
        return {
          productId: l.productId,
          name: p?.name ?? '—',
          unit: p?.unit ?? null,
          orderedQty: Number(l.qty),
          receivedQty: Number(l.receivedQty),
          lastPrice: lastPrices.get(l.productId) ?? null,
        };
      }),
      hint: 'Взвесьте и пересчитайте до подписи накладной',
    };
  }

  /**
   * Провести приёмку с расхождениями.
   * Каждое расхождение фиксируется — по ним потом разговаривают
   * с поставщиком, а не «мне кажется, вы недовозите».
   */
  @Post('requests/:id/receive')
  @RequirePermission('stock.supply')
  async receive(
    @Param('id') id: string,
    @Body() dto: {
      warehouseId: string;
      lines: { productId: string; qty: number; price: number; note?: string }[];
    },
    @Req() reqUser: any,
  ) {
    const request = await this.prisma.supplyRequest.findUnique({
      where: { id },
      include: { lines: true, supplier: true },
    });
    if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });

    const orderedBy = new Map(request.lines.map((l) => [l.productId, Number(l.qty)] as const));
    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.lines.map((l) => l.productId) } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(products.map((p) => [p.id, p.name] as const));

    const discrepancies: {
      kind: 'short' | 'over' | 'extra' | 'price_up';
      name: string; text: string; money?: number;
    }[] = [];

    // Недовоз и перевоз
    for (const l of dto.lines) {
      const ordered = orderedBy.get(l.productId);
      const name = nameBy.get(l.productId) ?? '—';

      if (ordered === undefined) {
        discrepancies.push({
          kind: 'extra', name,
          text: `${name} не заказывали — привезли ${l.qty}`,
          money: Math.round(l.qty * l.price),
        });
      } else if (l.qty < ordered * 0.98) {
        const short = +(ordered - l.qty).toFixed(3);
        discrepancies.push({
          kind: 'short', name,
          text: `${name}: заказывали ${ordered}, привезли ${l.qty} — недовоз ${short}`,
          money: Math.round(short * l.price),
        });
      } else if (l.qty > ordered * 1.02) {
        discrepancies.push({
          kind: 'over', name,
          text: `${name}: привезли ${l.qty} вместо ${ordered}`,
          money: Math.round((l.qty - ordered) * l.price),
        });
      }

      // Подорожание больше десяти процентов — повод спросить
      // до подписи, а не после оплаты
      const last = await this.prisma.stockMovement.findFirst({
        where: { productId: l.productId, qtyDelta: { gt: 0 } },
        orderBy: { at: 'desc' },
        select: { unitCost: true },
      });
      if (last && last.unitCost > 0) {
        const growth = Math.round(((l.price - last.unitCost) / last.unitCost) * 100);
        if (growth >= 10) {
          discrepancies.push({
            kind: 'price_up', name,
            text: `${name} подорожал на ${growth}%: было ${Math.trunc(last.unitCost / 100)} ₸, стало ${Math.trunc(l.price / 100)} ₸`,
          });
        }
      }
    }

    // Совсем не привезли
    for (const [productId, qty] of orderedBy) {
      if (!dto.lines.some((l) => l.productId === productId)) {
        discrepancies.push({
          kind: 'short',
          name: nameBy.get(productId) ?? '—',
          text: `${nameBy.get(productId) ?? 'Товар'} не привезли вовсе — заказывали ${qty}`,
        });
      }
    }

    const total = dto.lines.reduce((s, l) => s + l.qty * l.price, 0);

    const last = await this.prisma.stockDoc.findFirst({
      where: { accountId: reqUser.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const doc = await this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      const d = await tx.stockDoc.create({
        data: {
          accountId: reqUser.user.acc,
          locationId: wh?.locationId ?? request.locationId,
          type: 'SUPPLY',
          status: 'DRAFT',
          number: (last?.number ?? 0) + 1,
          warehouseId: dto.warehouseId,
          supplierId: request.supplierId,
          note: `По заявке №${request.number}`,
          createdBy: reqUser.user.sub,
          lines: {
            create: dto.lines.map((l, idx) => ({
              productId: l.productId,
              qty: l.qty as any,
              unitCost: l.price,
              sortOrder: idx,
            })),
          },
        },
      });

      for (const l of dto.lines) {
        const rl = request.lines.find((x) => x.productId === l.productId);
        if (rl) {
          await tx.supplyRequestLine.update({
            where: { id: rl.id },
            data: { receivedQty: l.qty as any },
          });
        }
      }

      const allFull = request.lines.every((rl) => {
        const got = dto.lines.find((l) => l.productId === rl.productId);
        return got && got.qty >= Number(rl.qty) * 0.98;
      });

      await tx.supplyRequest.update({
        where: { id },
        data: {
          status: allFull ? 'RECEIVED' : 'PARTIAL',
          closedAt: allFull ? new Date() : null,
        },
      });

      return d;
    });

    const shortMoney = discrepancies
      .filter((d) => d.kind === 'short')
      .reduce((s, d) => s + (d.money ?? 0), 0);

    return {
      docId: doc.id,
      docNumber: doc.number,
      total,
      discrepancies,
      shortMoney,
      // Документ создан черновиком: кладовщик проверяет цифры
      // и проводит отдельным действием. Провести случайно нельзя
      status: 'DRAFT',
      hint: discrepancies.length
        ? `Найдено расхождений: ${discrepancies.length} — покажите поставщику до подписи`
        : 'Всё совпало с заявкой — можно проводить',
    };
  }

  /**
   * Надёжность поставщиков: кто возит вовремя и полностью.
   * Цифры вместо ощущений при выборе, с кем работать.
   */
  @Get('suppliers/reliability')
  @RequirePermission('stock.supply')
  async reliability(@Req() req: any, @Query('days') days = '90') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const requests = await this.prisma.supplyRequest.findMany({
      where: {
        accountId: req.user.acc,
        createdAt: { gte: from },
        status: { in: ['RECEIVED', 'PARTIAL'] },
      },
      include: { lines: true, supplier: true },
    });

    const bySupplier = new Map<string, {
      name: string; phone: string | null;
      total: number; full: number; late: number; shortLines: number; allLines: number;
    }>();

    for (const r of requests) {
      const cur = bySupplier.get(r.supplierId) ?? {
        name: r.supplier.name, phone: r.supplier.phone,
        total: 0, full: 0, late: 0, shortLines: 0, allLines: 0,
      };
      cur.total++;
      if (r.status === 'RECEIVED') cur.full++;
      if (r.expectedAt && r.closedAt && r.closedAt > r.expectedAt) cur.late++;
      for (const l of r.lines) {
        cur.allLines++;
        if (Number(l.receivedQty) < Number(l.qty) * 0.98) cur.shortLines++;
      }
      bySupplier.set(r.supplierId, cur);
    }

    const rows = [...bySupplier.entries()].map(([id, v]) => ({
      supplierId: id,
      name: v.name,
      phone: v.phone,
      deliveries: v.total,
      fullPct: v.total ? Math.round((v.full / v.total) * 100) : 0,
      latePct: v.total ? Math.round((v.late / v.total) * 100) : 0,
      shortLinesPct: v.allLines ? Math.round((v.shortLines / v.allLines) * 100) : 0,
      // Оценка одним числом: комплектность минус штраф за опоздания
      score: v.total
        ? Math.max(0, Math.round((v.full / v.total) * 100 - (v.late / v.total) * 30))
        : 0,
    })).sort((a, b) => b.score - a.score);

    return {
      periodDays: Number(days),
      rows,
      best: rows[0] ?? null,
      worst: rows.length > 1 ? rows[rows.length - 1] : null,
      note: rows.length > 1 && rows[rows.length - 1].score < 60
        ? `${rows[rows.length - 1].name} возит хуже других — поищите замену`
        : null,
    };
  }
}

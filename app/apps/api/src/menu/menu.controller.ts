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

  /**
   * Автоматический стоп-лист по складу.
   *
   * У конкурентов повар руками ставит блюдо в стоп, когда заметит.
   * Обычно замечает после того, как гость заказал и ждёт двадцать
   * минут. Мы считаем по остаткам и техкартам: система знает,
   * что конина кончилась, раньше повара.
   */
  @Get('availability')
  @UseGuards(JwtGuard)
  async availability(@Query('locationId') locationId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { locationId, isActive: true },
      orderBy: { isDefault: 'desc' },
    });
    if (!warehouse) return { rows: [], note: 'Склад точки не настроен' };

    const [products, cards, balances, manual] = await Promise.all([
      this.prisma.product.findMany({
        where: { isDeleted: false, type: 'DISH' },
        select: { id: true, name: true },
      }),
      this.prisma.techCard.findMany({ include: { lines: true } }),
      this.prisma.stockBalance.findMany({ where: { warehouseId: warehouse.id } }),
      this.prisma.stopListEntry.findMany({ where: { locationId } }),
    ]);

    const qtyBy = new Map(balances.map((b) => [b.productId, Number(b.qty)]));
    const cardBy = new Map(cards.map((c) => [c.productId, c]));
    const stopBy = new Map(manual.map((s) => [s.productId, s]));

    const componentNames = await this.prisma.product.findMany({
      where: { id: { in: cards.flatMap((c) => c.lines.map((l) => l.componentId)) } },
      select: { id: true, name: true },
    });
    const compName = new Map(componentNames.map((p) => [p.id, p.name]));

    const rows = products.map((p) => {
      const stop = stopBy.get(p.id);
      const card = cardBy.get(p.id);

      // Ручной стоп сильнее автоматического: повар мог убрать блюдо
      // по причине, которой нет в остатках — сломался гриль
      if (stop && stop.remainingQty === null) {
        return {
          productId: p.id, name: p.name,
          available: false, portionsLeft: 0,
          reason: stop.reason ?? 'В стопе',
          source: 'manual' as const,
        };
      }

      if (!card) {
        return {
          productId: p.id, name: p.name,
          available: true, portionsLeft: null,
          reason: null, source: 'no_card' as const,
        };
      }

      // Считаем по самому дефицитному компоненту
      let min = Infinity;
      let scarce: string | null = null;
      for (const l of card.lines) {
        const need = Number(l.bruttoQty);
        if (need <= 0) continue;
        const have = qtyBy.get(l.componentId) ?? 0;
        const portions = Math.floor(have / need);
        if (portions < min) { min = portions; scarce = l.componentId; }
      }

      const left = min === Infinity ? null : Math.max(0, min);
      const manualLimit = stop?.remainingQty !== null && stop?.remainingQty !== undefined
        ? Number(stop.remainingQty) : null;
      const portions = manualLimit !== null
        ? Math.min(manualLimit, left ?? manualLimit)
        : left;

      return {
        productId: p.id,
        name: p.name,
        available: portions === null || portions > 0,
        portionsLeft: portions,
        // Называем виновника: «кончилась конина» точнее,
        // чем «блюдо недоступно» — повар знает, что заказать
        reason: portions === 0 && scarce
          ? `Кончилась ${(compName.get(scarce) ?? 'ингредиент').toLowerCase()}`
          : null,
        scarcestName: scarce ? compName.get(scarce) ?? null : null,
        source: manualLimit !== null ? 'manual_limit' as const : 'auto' as const,
        // Предупреждение до нуля: три порции — повод сказать
        // официантам, чтобы не обещали гостям
        warning: portions !== null && portions > 0 && portions <= 3,
      };
    });

    const out = rows.filter((r) => !r.available || r.warning);

    return {
      checkedAt: new Date(),
      stopped: rows.filter((r) => !r.available).length,
      lowStock: rows.filter((r) => r.warning).length,
      rows: out.sort((a, b) => (a.portionsLeft ?? 999) - (b.portionsLeft ?? 999)),
      allRows: rows,
    };
  }

  /**
   * Поставить блюдо в стоп вручную.
   * Причина обязательна: через час никто не помнит, почему убрали,
   * и блюдо висит в стопе неделю.
   */
  @Post('stop-list')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('menu.edit')
  async addStop(
    @Body() dto: { locationId: string; productId: string; reason: string; remainingQty?: number },
    @Req() req: any,
  ) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'Напишите причину — через час никто не вспомнит',
      });
    }

    const existing = await this.prisma.stopListEntry.findFirst({
      where: { locationId: dto.locationId, productId: dto.productId },
    });

    if (existing) {
      await this.prisma.stopListEntry.update({
        where: { id: existing.id },
        data: {
          reason: dto.reason.trim(),
          remainingQty: (dto.remainingQty ?? null) as any,
        },
      });
      return { ok: true, updated: true };
    }

    await this.prisma.stopListEntry.create({
      data: {
        locationId: dto.locationId,
        productId: dto.productId,
        reason: dto.reason.trim(),
        remainingQty: (dto.remainingQty ?? null) as any,
      },
    });
    return { ok: true, created: true };
  }

  /** Убрать из стопа — привезли продукты, починили гриль. */
  @Post('stop-list/remove')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('menu.edit')
  async removeStop(@Body() dto: { locationId: string; productId: string }) {
    await this.prisma.stopListEntry.deleteMany({
      where: { locationId: dto.locationId, productId: dto.productId },
    });
    return { ok: true };
  }

  /**
   * Активное меню на текущий момент: бизнес-ланч, завтраки, бар.
   *
   * Касса вызывает при входе и раз в пять минут. Без расписания
   * кассир следит за временем сам и продаёт ланч в девять вечера
   * по дневной цене.
   */
  @Get('active-schedule')
  @UseGuards(JwtGuard)
  async activeSchedule(
    @Query('locationId') locationId: string,
    @Query('at') at?: string,
  ) {
    const now = at ? new Date(at) : new Date();
    const dow = (now.getDay() + 6) % 7;
    const minutes = now.getHours() * 60 + now.getMinutes();

    const schedules = await this.prisma.menuSchedule.findMany({
      where: {
        isActive: true,
        OR: [{ locationId }, { locationId: null }],
      },
      include: { items: true },
    });

    const active = schedules.filter((s) => {
      const dayOk = s.days.length === 0 || s.days.includes(dow);
      // Ночной интервал: бар с 20:00 до 02:00 пересекает полночь,
      // и обычное сравнение здесь не работает
      const timeOk = s.fromMin <= s.toMin
        ? minutes >= s.fromMin && minutes < s.toMin
        : minutes >= s.fromMin || minutes < s.toMin;
      return dayOk && timeOk;
    });

    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

    // Ближайшее расписание: кассир видит, что скоро начнётся,
    // и может предупредить гостя — «через 10 минут ланч дешевле»
    const upcoming = schedules
      .filter((s) => !active.includes(s))
      .filter((s) => s.days.length === 0 || s.days.includes(dow))
      .filter((s) => s.fromMin > minutes)
      .sort((a, b) => a.fromMin - b.fromMin)[0];

    return {
      at: now,
      active: active.map((s) => ({
        scheduleId: s.id,
        name: s.name,
        window: `${fmt(s.fromMin)}–${fmt(s.toMin)}`,
        pricePct: s.pricePct,
        endsInMin: s.toMin > minutes ? s.toMin - minutes : (1440 - minutes) + s.toMin,
        items: s.items.map((i) => ({
          productId: i.productId,
          price: i.price,
          onlyInTime: i.onlyInTime,
        })),
      })),
      upcoming: upcoming ? {
        name: upcoming.name,
        startsInMin: upcoming.fromMin - minutes,
        window: `${fmt(upcoming.fromMin)}–${fmt(upcoming.toMin)}`,
      } : null,
      // Позиции, скрытые вне своего времени: касса не покажет
      // завтраки вечером, и кассир не объяснит гостю, почему
      // блюдо из меню недоступно
      hiddenNow: schedules
        .filter((s) => !active.includes(s))
        .flatMap((s) => s.items.filter((i) => i.onlyInTime).map((i) => i.productId)),
    };
  }

  /** Создать расписание: бизнес-ланч, завтраки, вечернее меню. */
  @Post('schedules')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('menu.edit')
  async createSchedule(
    @Body() dto: {
      name: string; locationId?: string;
      days?: number[]; from: string; to: string;
      pricePct?: number;
      items?: { productId: string; price?: number; onlyInTime?: boolean }[];
    },
    @Req() req: any,
  ) {
    const toMin = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const fromMin = toMin(dto.from);
    const endMin = toMin(dto.to);

    if (fromMin === endMin) {
      throw new BadRequestException({
        code: 'BAD_WINDOW',
        message: 'Начало и конец совпадают — укажите разное время',
      });
    }

    const s = await this.prisma.menuSchedule.create({
      data: {
        accountId: req.user.acc,
        locationId: dto.locationId ?? null,
        name: dto.name.trim(),
        days: dto.days ?? [],
        fromMin, toMin: endMin,
        pricePct: dto.pricePct ?? null,
        items: dto.items?.length ? {
          create: dto.items.map((i) => ({
            productId: i.productId,
            price: i.price ?? null,
            onlyInTime: i.onlyInTime ?? false,
          })),
        } : undefined,
      },
      include: { items: true },
    });

    return { scheduleId: s.id, name: s.name, items: s.items.length };
  }

  /**
   * Массовое изменение цен: поднять всё меню на процент.
   * Инфляция или подорожание сырья — владелец не должен править
   * восемьдесят позиций руками.
   */
  @Post('prices/bulk')
  @UseGuards(JwtGuard, PermissionsGuard)
  @RequirePermission('menu.edit')
  async bulkPrices(
    @Body() dto: {
      percent?: number;
      categoryId?: string;
      productIds?: string[];
      roundTo?: number;
      dryRun?: boolean;
    },
    @Req() req: any,
  ) {
    if (!dto.percent) throw new BadRequestException({ code: 'NO_PERCENT' });

    const products = await this.prisma.product.findMany({
      where: {
        accountId: req.user.acc,
        isDeleted: false,
        type: { in: ['DISH', 'GOODS'] },
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.productIds?.length ? { id: { in: dto.productIds } } : {}),
      },
      select: { id: true, name: true, basePrice: true },
    });

    // Округление до сотен: цена 2 847 ₸ выглядит как ошибка,
    // 2 850 — как решение
    const round = (dto.roundTo ?? 5000);
    const changes = products.map((p) => {
      const raw = Math.round(p.basePrice * (100 + dto.percent!) / 100);
      const next = Math.round(raw / round) * round;
      return {
        productId: p.id,
        name: p.name,
        from: p.basePrice,
        to: next,
        deltaPct: p.basePrice > 0
          ? +(((next - p.basePrice) / p.basePrice) * 100).toFixed(1) : 0,
      };
    }).filter((c) => c.to !== c.from);

    // Предпросмотр обязателен: поднять цены на всё меню —
    // необратимое действие, которое заметят гости
    if (dto.dryRun !== false) {
      return {
        preview: true,
        count: changes.length,
        changes: changes.slice(0, 100),
        hint: 'Проверьте цены и повторите с dryRun: false',
      };
    }

    await this.prisma.$transaction(
      changes.map((c) =>
        this.prisma.product.update({
          where: { id: c.productId },
          data: { basePrice: c.to },
        }),
      ),
    );

    return { applied: true, count: changes.length };
  }
}

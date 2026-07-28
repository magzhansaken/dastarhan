// apps/api/src/stock/production.controller.ts
// Производство полуфабрикатов: зирвак, тесто, бульон, соусы.
//
// Кухня готовит заготовки партиями с утра, а расходует весь день.
// Без учёта производства себестоимость блюда считается по сырью
// каждый раз заново — и не видно, сколько ушло на пробы и брак.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class ProduceDto {
  @IsString() warehouseId!: string;
  @IsString() productId!: string;
  @IsNumber() @Min(0.001) qty!: number;
  @IsOptional() @IsString() note?: string;
}

@Controller('production')
@UseGuards(JwtGuard, PermissionsGuard)
export class ProductionController {
  constructor(private prisma: PrismaService) {}

  /**
   * Что нужно приготовить сегодня.
   *
   * Считаем по продажам за прошлую неделю: сколько зирвака уйдёт
   * во вторник, столько и варим. Повар не гадает и не готовит
   * кастрюлю, которая скиснет.
   */
  @Get('plan')
  @RequirePermission('stock.supply')
  async plan(@Req() req: any, @Query('warehouseId') warehouseId: string) {
    // Полуфабрикаты — товары с техкартой, которые сами входят
    // в другие техкарты
    const cards = await this.prisma.techCard.findMany({ include: { lines: true } });
    const usedAsComponent = new Set(cards.flatMap((c) => c.lines.map((l) => l.componentId)));
    const prepackIds = cards
      .map((c) => c.productId)
      .filter((id) => usedAsComponent.has(id));

    if (!prepackIds.length) {
      return { rows: [], note: 'Полуфабрикатов нет — техкарты не ссылаются друг на друга' };
    }

    const dow = (new Date().getDay() + 6) % 7;
    const from = new Date();
    from.setDate(from.getDate() - 28);

    // Расход в этот же день недели за четыре недели: во вторник
    // и в субботу расходится по-разному
    const moves = await this.prisma.stockMovement.findMany({
      where: {
        accountId: req.user.acc,
        warehouseId,
        productId: { in: prepackIds },
        qtyDelta: { lt: 0 },
        at: { gte: from },
      },
      select: { productId: true, qtyDelta: true, at: true },
    });

    const sameDow = moves.filter((m) => (m.at.getDay() + 6) % 7 === dow);
    const usage = new Map<string, { sum: number; days: Set<string> }>();
    for (const m of sameDow) {
      const cur = usage.get(m.productId) ?? { sum: 0, days: new Set<string>() };
      cur.sum += Math.abs(Number(m.qtyDelta));
      cur.days.add(m.at.toISOString().slice(0, 10));
      usage.set(m.productId, cur);
    }

    const [balances, products] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where: { warehouseId, productId: { in: prepackIds } },
      }),
      this.prisma.product.findMany({
        where: { id: { in: prepackIds } },
        select: { id: true, name: true, unit: true, shelfLifeHours: true },
      }),
    ]);
    const haveBy = new Map(balances.map((b) => [b.productId, Number(b.qty)]));
    const prodBy = new Map(products.map((p) => [p.id, p]));

    const rows = [];
    for (const id of prepackIds) {
      const u = usage.get(id);
      if (!u || !u.days.size) continue;

      const perDay = u.sum / u.days.size;
      const have = haveBy.get(id) ?? 0;
      const p = prodBy.get(id);
      const need = Math.max(0, perDay - have);

      if (need <= 0.001) continue;

      rows.push({
        productId: id,
        name: p?.name ?? '—',
        unit: p?.unit ?? null,
        avgUsage: +perDay.toFixed(3),
        haveQty: +have.toFixed(3),
        toCook: +need.toFixed(3),
        shelfLifeHours: p?.shelfLifeHours ?? null,
        // Скоропортящееся варим впритык, стойкое можно с запасом
        advice: p?.shelfLifeHours && p.shelfLifeHours <= 24
          ? 'Скоропортящееся — готовьте под расход дня'
          : null,
      });
    }

    return {
      forDate: new Date(),
      dayOfWeek: ['понедельник','вторник','среду','четверг','пятницу','субботу','воскресенье'][dow],
      basedOn: 'расход в этот день недели за 4 недели',
      rows: rows.sort((a, b) => b.toCook - a.toCook),
      note: rows.length
        ? `Приготовить ${rows.length} заготовок`
        : 'Заготовок хватает',
    };
  }

  /**
   * Провести производство: списать сырьё, оприходовать заготовку.
   * Себестоимость считается по факту списания, а не по нормам —
   * если повар взял больше, это видно.
   */
  @Post()
  @RequirePermission('stock.writeoff')
  async produce(@Body() dto: ProduceDto, @Req() req: any) {
    const card = await this.prisma.techCard.findFirst({
      where: { productId: dto.productId },
      orderBy: { version: 'desc' },
      include: { lines: true },
    });
    if (!card) {
      throw new BadRequestException({
        code: 'NO_TECHCARD',
        message: 'У полуфабриката нет техкарты — непонятно, из чего готовить',
      });
    }

    const output = Number(card.outputQty) || 1;
    const factor = dto.qty / output;

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: dto.warehouseId,
        productId: { in: card.lines.map((l) => l.componentId) },
      },
    });
    const balBy = new Map(balances.map((b) => [b.productId, b]));

    const names = await this.prisma.product.findMany({
      where: { id: { in: card.lines.map((l) => l.componentId) } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(names.map((n) => [n.id, n.name]));

    // Проверяем всё сырьё до списания: начать готовить и на
    // середине обнаружить нехватку — хуже, чем не начать
    const missing: string[] = [];
    let cost = 0;
    for (const l of card.lines) {
      const need = Number(l.bruttoQty) * factor;
      const bal = balBy.get(l.componentId);
      const have = bal ? Number(bal.qty) : 0;
      if (have < need) {
        missing.push(
          `${nameBy.get(l.componentId) ?? 'сырьё'}: нужно ${need.toFixed(2)}, есть ${have.toFixed(2)}`,
        );
      }
      cost += need * (bal?.avgCost ?? 0);
    }

    if (missing.length) {
      throw new BadRequestException({
        code: 'NOT_ENOUGH',
        message: 'Не хватает сырья',
        missing,
      });
    }

    const unitCost = Math.round(cost / dto.qty);
    const last = await this.prisma.stockDoc.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const doc = await this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });

      const d = await tx.stockDoc.create({
        data: {
          accountId: req.user.acc,
          locationId: wh!.locationId,
          type: 'PRODUCTION',
          status: 'POSTED',
          number: (last?.number ?? 0) + 1,
          warehouseId: dto.warehouseId,
          note: dto.note ?? null,
          createdBy: req.user.sub,
          postedAt: new Date(),
        },
      });

      // Списываем сырьё
      for (const l of card.lines) {
        const need = Number(l.bruttoQty) * factor;
        const bal = balBy.get(l.componentId)!;
        await tx.stockBalance.update({
          where: { id: bal.id },
          data: { qty: Number(bal.qty) - need },
        });
        await tx.stockMovement.create({
          data: {
            accountId: req.user.acc,
            warehouseId: dto.warehouseId,
            productId: l.componentId,
            docId: d.id,
            qtyDelta: -need,
            unitCost: bal.avgCost,
          },
        });
      }

      // Приходуем заготовку по скользящей средней
      const out = await tx.stockBalance.findFirst({
        where: { warehouseId: dto.warehouseId, productId: dto.productId },
      });
      const curQty = out ? Number(out.qty) : 0;
      const nextQty = curQty + dto.qty;
      const nextAvg = curQty <= 0
        ? unitCost
        : Math.round((curQty * (out?.avgCost ?? 0) + cost) / nextQty);

      if (out) {
        await tx.stockBalance.update({
          where: { id: out.id }, data: { qty: nextQty, avgCost: nextAvg },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            warehouseId: dto.warehouseId, productId: dto.productId,
            qty: nextQty, avgCost: nextAvg,
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          accountId: req.user.acc,
          warehouseId: dto.warehouseId,
          productId: dto.productId,
          docId: d.id,
          qtyDelta: dto.qty,
          unitCost,
        },
      });

      // Партия со сроком: заготовка живёт часы, а не дни
      const p = await tx.product.findUnique({
        where: { id: dto.productId },
        select: { shelfLifeHours: true, name: true },
      });
      if (p?.shelfLifeHours) {
        const now = new Date();
        await tx.stockBatch.create({
          data: {
            accountId: req.user.acc,
            warehouseId: dto.warehouseId,
            productId: dto.productId,
            qty: dto.qty as any,
            unitCost,
            producedAt: now,
            expiresAt: new Date(now.getTime() + p.shelfLifeHours * 3600_000),
            byUserId: req.user.sub,
            docId: d.id,
          },
        }).catch(() => null);
      }

      return d;
    });

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { name: true, shelfLifeHours: true },
    });

    return {
      ok: true,
      docId: doc.id,
      number: doc.number,
      name: product?.name,
      qty: dto.qty,
      totalCost: Math.round(cost),
      unitCost,
      expiresAt: product?.shelfLifeHours
        ? new Date(Date.now() + product.shelfLifeHours * 3600_000) : null,
      // Себестоимость за единицу — то, что попадёт в блюда
      hint: `Себестоимость ${Math.trunc(unitCost / 100)} ₸ за единицу`,
    };
  }

  /**
   * Выход заготовок: сколько получилось из сырья по факту.
   * Если выход падает, значит либо сырьё хуже, либо повар
   * начал брать больше нормы.
   */
  @Get('yield')
  @RequirePermission('stock.supply')
  async yieldReport(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const docs = await this.prisma.stockDoc.findMany({
      where: {
        accountId: req.user.acc,
        type: 'PRODUCTION',
        status: 'POSTED',
        postedAt: { gte: from },
      },
      orderBy: { postedAt: 'desc' },
      take: 200,
    });

    const moves = await this.prisma.stockMovement.findMany({
      where: { docId: { in: docs.map((d) => d.id) } },
      select: { docId: true, productId: true, qtyDelta: true, unitCost: true },
    });

    const byDoc = new Map<string, typeof moves>();
    for (const m of moves) {
      const arr = byDoc.get(m.docId!) ?? [];
      arr.push(m);
      byDoc.set(m.docId!, arr);
    }

    const byProduct = new Map<string, { runs: number; qty: number; cost: number }>();
    for (const [, list] of byDoc) {
      const out = list.find((m) => Number(m.qtyDelta) > 0);
      if (!out) continue;
      const spent = list
        .filter((m) => Number(m.qtyDelta) < 0)
        .reduce((s, m) => s + Math.abs(Number(m.qtyDelta)) * m.unitCost, 0);

      const cur = byProduct.get(out.productId) ?? { runs: 0, qty: 0, cost: 0 };
      cur.runs++;
      cur.qty += Number(out.qtyDelta);
      cur.cost += spent;
      byProduct.set(out.productId, cur);
    }

    const names = await this.prisma.product.findMany({
      where: { id: { in: [...byProduct.keys()] } },
      select: { id: true, name: true, unit: true },
    });
    const nameBy = new Map(names.map((n) => [n.id, n]));

    return {
      periodDays: Number(days),
      rows: [...byProduct.entries()].map(([id, v]) => ({
        productId: id,
        name: nameBy.get(id)?.name ?? '—',
        unit: nameBy.get(id)?.unit ?? null,
        runs: v.runs,
        totalQty: +v.qty.toFixed(3),
        avgBatch: +(v.qty / v.runs).toFixed(3),
        // Средняя себестоимость: растёт — либо сырьё дорожает,
        // либо повар льёт лишнее
        avgCost: v.qty > 0 ? Math.round(v.cost / v.qty) : 0,
      })).sort((a, b) => b.runs - a.runs),
    };
  }
}

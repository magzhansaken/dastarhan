// apps/api/src/stock/transfer.controller.ts
// Перемещения между точками и складами.
//
// У перемещения две стороны, и в этом вся сложность. Отправили
// 10 кг, доехало 9 — расхождение надо поймать, пока водитель
// не уехал. Через месяц на инвентаризации виноватых не найти.
import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('transfers')
@UseGuards(JwtGuard, PermissionsGuard)
export class TransferController {
  constructor(private prisma: PrismaService) {}

  /**
   * Отправить товар. Списываем сразу — товар физически уехал,
   * и на складе-отправителе его больше нет.
   */
  @Post()
  @RequirePermission('stock.transfer')
  async send(
    @Body() dto: {
      fromWarehouseId: string;
      toWarehouseId: string;
      lines: { productId: string; qty: number }[];
      note?: string;
    },
    @Req() req: any,
  ) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException({
        code: 'SAME_WAREHOUSE',
        message: 'Склад отправителя и получателя совпадают',
      });
    }
    if (!dto.lines?.length) throw new BadRequestException({ code: 'EMPTY' });

    const balances = await this.prisma.stockBalance.findMany({
      where: {
        warehouseId: dto.fromWarehouseId,
        productId: { in: dto.lines.map((l) => l.productId) },
      },
    });
    const balBy = new Map(balances.map((b) => [b.productId, b]));

    const names = await this.prisma.product.findMany({
      where: { id: { in: dto.lines.map((l) => l.productId) } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(names.map((n) => [n.id, n.name]));

    // Проверяем всё до списания: отправить половину и застрять
    // на второй позиции хуже, чем не начинать
    const missing = dto.lines
      .filter((l) => {
        const b = balBy.get(l.productId);
        return !b || Number(b.qty) < l.qty;
      })
      .map((l) => {
        const have = balBy.get(l.productId);
        return `${nameBy.get(l.productId) ?? '—'}: есть ${have ? Number(have.qty).toFixed(2) : 0}, нужно ${l.qty}`;
      });

    if (missing.length) {
      throw new BadRequestException({
        code: 'NOT_ENOUGH',
        message: 'Не хватает на складе',
        missing,
      });
    }

    const last = await this.prisma.transfer.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const transfer = await this.prisma.$transaction(async (tx) => {
      const t = await tx.transfer.create({
        data: {
          accountId: req.user.acc,
          number: (last?.number ?? 0) + 1,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          sentBy: req.user.sub,
          note: dto.note ?? null,
          lines: {
            create: dto.lines.map((l) => ({
              productId: l.productId,
              sentQty: l.qty as any,
              unitCost: balBy.get(l.productId)?.avgCost ?? 0,
            })),
          },
        },
        include: { lines: true },
      });

      for (const l of dto.lines) {
        const b = balBy.get(l.productId)!;
        await tx.stockBalance.update({
          where: { id: b.id },
          data: { qty: Number(b.qty) - l.qty },
        });
        await tx.stockMovement.create({
          data: {
            accountId: req.user.acc,
            warehouseId: dto.fromWarehouseId,
            productId: l.productId,
            qtyDelta: -l.qty,
            unitCost: b.avgCost,
          },
        });
      }

      return t;
    });

    const total = transfer.lines.reduce(
      (s, l) => s + Number(l.sentQty) * l.unitCost, 0,
    );

    return {
      transferId: transfer.id,
      number: transfer.number,
      lines: transfer.lines.length,
      totalCost: Math.round(total),
      // Товар в пути: пока не приняли, он ничей. Это состояние
      // видно в отчётах, чтобы недостача не всплыла внезапно
      status: 'SENT',
      hint: 'Товар в пути — примите на второй точке, чтобы он появился в остатках',
    };
  }

  /** Что едет к нам — принимающая точка видит ожидаемое. */
  @Get('incoming')
  @RequirePermission('stock.transfer')
  async incoming(@Query('warehouseId') warehouseId: string) {
    const rows = await this.prisma.transfer.findMany({
      where: { toWarehouseId: warehouseId, status: 'SENT' },
      orderBy: { sentAt: 'asc' },
      include: { lines: true },
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.productId)) } },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const now = Date.now();
    return rows.map((t) => {
      const hours = Math.floor((now - t.sentAt.getTime()) / 3600_000);
      return {
        transferId: t.id,
        number: t.number,
        sentAt: t.sentAt,
        hoursInTransit: hours,
        // Больше суток в пути — либо забыли принять, либо товар
        // не доехал. Оба случая требуют звонка
        stale: hours > 24,
        lines: t.lines.map((l) => ({
          productId: l.productId,
          name: byId.get(l.productId)?.name ?? '—',
          unit: byId.get(l.productId)?.unit ?? null,
          sentQty: Number(l.sentQty),
        })),
      };
    });
  }

  /**
   * Принять с пересчётом. Расхождение фиксируется на месте:
   * недостача остаётся на отправителе, потому что это его потеря.
   */
  @Post(':id/receive')
  @RequirePermission('stock.transfer')
  async receive(
    @Param('id') id: string,
    @Body() dto: { lines: { productId: string; qty: number; note?: string }[] },
    @Req() req: any,
  ) {
    const t = await this.prisma.transfer.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!t) throw new NotFoundException({ code: 'TRANSFER_NOT_FOUND' });
    if (t.status !== 'SENT') {
      throw new BadRequestException({
        code: 'ALREADY_RECEIVED',
        message: 'Перемещение уже принято',
      });
    }

    const names = await this.prisma.product.findMany({
      where: { id: { in: t.lines.map((l) => l.productId) } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(names.map((n) => [n.id, n.name]));

    const gaps: { name: string; sent: number; got: number; loss: number }[] = [];
    let full = true;

    await this.prisma.$transaction(async (tx) => {
      for (const line of t.lines) {
        const got = dto.lines.find((l) => l.productId === line.productId);
        const qty = got ? got.qty : 0;
        const sent = Number(line.sentQty);

        if (qty < sent * 0.99) {
          full = false;
          gaps.push({
            name: nameBy.get(line.productId) ?? '—',
            sent, got: qty,
            loss: Math.round((sent - qty) * line.unitCost),
          });
        }

        await tx.transferLine.update({
          where: { id: line.id },
          data: { receivedQty: qty as any, note: got?.note ?? null },
        });

        if (qty <= 0) continue;

        // Приходуем то, что реально доехало
        const bal = await tx.stockBalance.findFirst({
          where: { warehouseId: t.toWarehouseId, productId: line.productId },
        });
        const curQty = bal ? Number(bal.qty) : 0;
        const nextQty = curQty + qty;
        const nextAvg = curQty <= 0
          ? line.unitCost
          : Math.round((curQty * (bal?.avgCost ?? 0) + qty * line.unitCost) / nextQty);

        if (bal) {
          await tx.stockBalance.update({
            where: { id: bal.id }, data: { qty: nextQty, avgCost: nextAvg },
          });
        } else {
          await tx.stockBalance.create({
            data: {
              warehouseId: t.toWarehouseId, productId: line.productId,
              qty: nextQty, avgCost: line.unitCost,
            },
          });
        }

        await tx.stockMovement.create({
          data: {
            accountId: t.accountId,
            warehouseId: t.toWarehouseId,
            productId: line.productId,
            qtyDelta: qty,
            unitCost: line.unitCost,
          },
        });
      }

      await tx.transfer.update({
        where: { id },
        data: {
          status: full ? 'RECEIVED' : 'PARTIAL',
          receivedAt: new Date(),
          receivedBy: req.user.sub,
        },
      });
    });

    const lossTotal = gaps.reduce((s, g) => s + g.loss, 0);

    return {
      ok: true,
      number: t.number,
      full,
      gaps,
      lossMoney: lossTotal,
      // Недостача остаётся на отправителе: он отвечает за то,
      // что положил в машину. Иначе принимающая точка платит
      // за чужую ошибку
      verdict: full
        ? 'Принято полностью'
        : `Недостача ${Math.trunc(lossTotal / 100).toLocaleString('ru-RU')} ₸ — остаётся на отправителе`,
    };
  }

  /**
   * Перемещения между точками: кто кому и сколько.
   * Если одна точка постоянно шлёт другой, значит закупка
   * настроена неверно — проще возить сразу туда.
   */
  @Get('flows')
  @RequirePermission('stock.supply')
  async flows(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const rows = await this.prisma.transfer.findMany({
      where: { accountId: req.user.acc, sentAt: { gte: from } },
      include: { lines: true },
    });

    // Точки аккаунта: у Warehouse нет связи location, только locationId
    const locations = await this.prisma.location.findMany({
      where: { accountId: req.user.acc },
      select: { id: true },
    });
    const warehouses = await this.prisma.warehouse.findMany({
      where: { locationId: { in: locations.map((l) => l.id) } },
      select: { id: true, name: true, locationId: true },
    });
    const whBy = new Map(warehouses.map((w) => [w.id, w]));

    const pairs = new Map<string, { from: string; to: string; count: number; cost: number }>();
    for (const t of rows) {
      const key = `${t.fromWarehouseId}→${t.toWarehouseId}`;
      const cost = t.lines.reduce(
        (s, l) => s + Number(l.receivedQty ?? l.sentQty) * l.unitCost, 0,
      );
      const cur = pairs.get(key) ?? {
        from: whBy.get(t.fromWarehouseId)?.name ?? '—',
        to: whBy.get(t.toWarehouseId)?.name ?? '—',
        count: 0, cost: 0,
      };
      cur.count++;
      cur.cost += cost;
      pairs.set(key, cur);
    }

    const flows = [...pairs.values()]
      .map((f) => ({ ...f, cost: Math.round(f.cost) }))
      .sort((a, b) => b.count - a.count);

    return {
      periodDays: Number(days),
      flows,
      pending: rows.filter((t) => t.status === 'SENT').length,
      withGaps: rows.filter((t) => t.status === 'PARTIAL').length,
      note: flows.length && flows[0].count >= 8
        ? `«${flows[0].from}» часто возит в «${flows[0].to}» — возможно, стоит закупать туда напрямую`
        : null,
    };
  }
}

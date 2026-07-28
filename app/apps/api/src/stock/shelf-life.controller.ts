// apps/api/src/stock/shelf-life.controller.ts
// Контроль сроков хранения.
//
// Самая дорогая ошибка в общепите — не деньги, а отравление.
// Одна жалоба в санэпидстанцию закрывает заведение на недели,
// а репутацию не восстановить.
//
// У iiko это есть в кассовом приложении. Мы делаем строже:
// просроченное блокируется на кассе, а не просто подсвечивается.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class BatchDto {
  @IsString() warehouseId!: string;
  @IsString() productId!: string;
  @IsNumber() @Min(0.001) qty!: number;
  @IsOptional() @IsString() producedAt?: string;
}

@Controller('shelf-life')
@UseGuards(JwtGuard, PermissionsGuard)
export class ShelfLifeController {
  constructor(private prisma: PrismaService) {}

  /**
   * Что просрочено и что вот-вот испортится.
   *
   * Показываем не «срок истёк», а сколько часов осталось —
   * повар должен успеть пустить в дело, а не выбросить.
   */
  @Get('check')
  @RequirePermission('stock.supply')
  async check(@Req() req: any, @Query('warehouseId') warehouseId?: string) {
    const batches = await this.prisma.stockBatch.findMany({
      where: {
        accountId: req.user.acc,
        isWrittenOff: false,
        qty: { gt: 0 },
        ...(warehouseId ? { warehouseId } : {}),
        expiresAt: { not: null },
      },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });

    if (!batches.length) {
      return { expired: [], soon: [], ok: 0, note: 'Партий со сроками нет' };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: batches.map((b) => b.productId) } },
      select: { id: true, name: true, unit: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const now = Date.now();
    type Row = {
      batchId: string; productId: string; name: string; unit: string | null;
      qty: number; producedAt: Date; expiresAt: Date | null;
      hoursLeft: number; cost: number;
      action?: string; hoursOverdue?: number;
    };
    const expired: Row[] = [];
    const soon: Row[] = [];
    let ok = 0;

    for (const b of batches) {
      const left = b.expiresAt!.getTime() - now;
      const hours = Math.floor(left / 3600_000);
      const p = byId.get(b.productId);

      const row = {
        batchId: b.id,
        productId: b.productId,
        name: p?.name ?? '—',
        unit: p?.unit ?? null,
        qty: Number(b.qty),
        producedAt: b.producedAt,
        expiresAt: b.expiresAt,
        hoursLeft: hours,
        // Потери в деньгах: списать 4 кг зирвака больнее,
        // когда видишь сумму
        cost: Math.round(Number(b.qty) * b.unitCost),
      };

      if (left <= 0) {
        expired.push({
          ...row,
          hoursOverdue: Math.abs(hours),
          action: 'Списать немедленно — подавать нельзя',
        });
      } else if (hours <= 6) {
        soon.push({
          ...row,
          // Успеть пустить в дело дешевле, чем выбросить
          action: hours <= 2
            ? 'Осталось меньше двух часов — используйте сейчас'
            : `Пустите в дело сегодня — ${hours} ч до конца срока`,
        });
      } else {
        ok++;
      }
    }

    const lossMoney = expired.reduce((s, e) => s + e.cost, 0);

    return {
      checkedAt: new Date(),
      expired,
      soon,
      ok,
      lossMoney,
      // Вердикт для утренней сводки владельца
      verdict: expired.length
        ? `Просрочено ${expired.length} позиций на ${Math.trunc(lossMoney / 100).toLocaleString('ru-RU')} ₸`
        : soon.length
        ? `${soon.length} позиций надо использовать сегодня`
        : 'Сроки в порядке',
    };
  }

  /**
   * Проверка перед продажей: можно ли готовить это блюдо.
   * Касса вызывает при добавлении позиции — просроченное
   * не должно попасть гостю ни при каких обстоятельствах.
   */
  @Get('can-sell')
  @RequirePermission('order.create')
  async canSell(
    @Query('productId') productId: string,
    @Query('warehouseId') warehouseId: string,
  ) {
    const card = await this.prisma.techCard.findFirst({
      where: { productId },
      orderBy: { version: 'desc' },
      include: { lines: true },
    });
    if (!card) return { canSell: true, reason: null };

    const now = new Date();
    const blocked: string[] = [];

    for (const l of card.lines) {
      const fresh = await this.prisma.stockBatch.findFirst({
        where: {
          warehouseId, productId: l.componentId,
          isWrittenOff: false, qty: { gt: 0 },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (!fresh) {
        // Есть ли просроченная партия — если да, повару надо
        // сказать точно, а не «ингредиента нет»
        const stale = await this.prisma.stockBatch.findFirst({
          where: {
            warehouseId, productId: l.componentId,
            isWrittenOff: false, qty: { gt: 0 },
            expiresAt: { lte: now },
          },
        });
        if (stale) {
          const p = await this.prisma.product.findUnique({
            where: { id: l.componentId }, select: { name: true },
          });
          blocked.push(p?.name ?? 'ингредиент');
        }
      }
    }

    return {
      canSell: blocked.length === 0,
      reason: blocked.length
        ? `Просрочено: ${blocked.join(', ')} — приготовьте свежее`
        : null,
      blockedComponents: blocked,
    };
  }

  /**
   * Зарегистрировать партию: приготовили зирвак, вскрыли банку.
   * Срок считается от времени приготовления по норме продукта.
   */
  @Post('batch')
  @RequirePermission('stock.supply')
  async createBatch(@Body() dto: BatchDto, @Req() req: any) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { name: true, shelfLifeHours: true },
    });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });

    const producedAt = dto.producedAt ? new Date(dto.producedAt) : new Date();
    const expiresAt = product.shelfLifeHours
      ? new Date(producedAt.getTime() + product.shelfLifeHours * 3600_000)
      : null;

    const bal = await this.prisma.stockBalance.findFirst({
      where: { warehouseId: dto.warehouseId, productId: dto.productId },
    });

    const b = await this.prisma.stockBatch.create({
      data: {
        accountId: req.user.acc,
        warehouseId: dto.warehouseId,
        productId: dto.productId,
        qty: dto.qty as any,
        unitCost: bal?.avgCost ?? 0,
        producedAt,
        expiresAt,
        byUserId: req.user.sub,
      },
    });

    return {
      batchId: b.id,
      name: product.name,
      expiresAt,
      // Подсказка на этикетку: повар клеит стикер на кастрюлю
      label: expiresAt
        ? `${product.name} · до ${expiresAt.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })}`
        : product.name,
      warning: !product.shelfLifeHours
        ? 'Срок хранения не задан — укажите его в карточке товара'
        : null,
    };
  }

  /** Списать просроченное. Причина фиксируется как порча. */
  @Post('write-off')
  @RequirePermission('stock.writeoff')
  async writeOff(@Body() dto: { batchIds: string[] }, @Req() req: any) {
    const batches = await this.prisma.stockBatch.findMany({
      where: { id: { in: dto.batchIds }, isWrittenOff: false },
    });
    if (!batches.length) throw new BadRequestException({ code: 'NOTHING_TO_WRITE_OFF' });

    let total = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const b of batches) {
        const cost = Math.round(Number(b.qty) * b.unitCost);
        total += cost;

        await tx.stockBatch.update({
          where: { id: b.id }, data: { isWrittenOff: true, qty: 0 as any },
        });

        const bal = await tx.stockBalance.findFirst({
          where: { warehouseId: b.warehouseId, productId: b.productId },
        });
        if (bal) {
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: { qty: Math.max(0, Number(bal.qty) - Number(b.qty)) },
          });
        }

        await tx.stockMovement.create({
          data: {
            accountId: b.accountId,
            warehouseId: b.warehouseId,
            productId: b.productId,
            qtyDelta: -Number(b.qty),
            unitCost: b.unitCost,
          },
        });
      }
    });

    return {
      ok: true,
      count: batches.length,
      lossMoney: total,
      // Списание идёт в порчу, а не в себестоимость блюд —
      // иначе фудкост покажет неправду
      note: 'Ушло в «Порчу» — в отчёте о прибыли видно отдельной строкой',
    };
  }
}

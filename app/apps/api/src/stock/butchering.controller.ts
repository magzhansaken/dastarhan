// apps/api/src/stock/butchering.controller.ts
// Акт разделки: одно сырьё → несколько частей с разной ценностью.
// Купили тушу конины 40 кг — получили вырезку, мякоть, кости, обрезь.
//
// Главная сложность: как распределить себестоимость. Делить поровну
// нельзя — вырезка стоит втрое дороже костей. Распределяем по
// коэффициентам ценности, сумма при этом сходится копейка в копейку.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class OutputDto {
  @IsString() productId!: string;
  @IsNumber() @Min(0.001) qty!: number;
  // Коэффициент ценности: вырезка 3.0, мякоть 1.5, кости 0.3.
  // Это не цена, а соотношение — сумма всё равно сойдётся с сырьём
  @IsNumber() @Min(0.01) valueRatio!: number;
}

class ButcheringDto {
  @IsString() warehouseId!: string;
  @IsString() sourceProductId!: string;
  @IsNumber() @Min(0.001) sourceQty!: number;
  @IsArray() outputs!: OutputDto[];
  @IsOptional() @IsString() note?: string;
}

@Controller('butchering')
@UseGuards(JwtGuard, PermissionsGuard)
export class ButcheringController {
  constructor(private prisma: PrismaService) {}

  /**
   * Предварительный расчёт: сколько будет стоить килограмм каждой части.
   * Технолог видит цифры до проведения и может поправить коэффициенты.
   */
  @Post('preview')
  @RequirePermission('stock.writeoff')
  async preview(@Body() dto: ButcheringDto) {
    const bal = await this.prisma.stockBalance.findFirst({
      where: { warehouseId: dto.warehouseId, productId: dto.sourceProductId },
    });
    const sourceCost = bal?.avgCost ?? 0;
    const totalCost = Math.round(sourceCost * dto.sourceQty);

    const ids = [dto.sourceProductId, ...dto.outputs.map((o) => o.productId)];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, unit: true },
    });
    const nameBy = new Map(products.map((p) => [p.id, p] as const));

    // Вес коэффициента × количество — так части с большим выходом
    // получают пропорционально больше себестоимости
    const weights = dto.outputs.map((o) => o.qty * o.valueRatio);
    const weightSum = weights.reduce((s, w) => s + w, 0);
    if (weightSum <= 0) throw new BadRequestException({ code: 'BAD_RATIOS' });

    let distributed = 0;
    const rows = dto.outputs.map((o, i) => {
      const share = i === dto.outputs.length - 1
        // Последней позиции отдаём остаток: иначе копейки теряются
        // при округлении, и акт не сходится с суммой сырья
        ? totalCost - distributed
        : Math.round(totalCost * weights[i] / weightSum);
      distributed += share;

      return {
        productId: o.productId,
        name: nameBy.get(o.productId)?.name ?? '—',
        unit: nameBy.get(o.productId)?.unit ?? null,
        qty: o.qty,
        valueRatio: o.valueRatio,
        cost: share,
        unitCost: o.qty > 0 ? Math.round(share / o.qty) : 0,
      };
    });

    const outputQty = dto.outputs.reduce((s, o) => s + o.qty, 0);

    return {
      sourceName: nameBy.get(dto.sourceProductId)?.name ?? '—',
      sourceQty: dto.sourceQty,
      sourceUnitCost: sourceCost,
      totalCost,
      outputs: rows,
      outputQty: +outputQty.toFixed(3),
      // Потери при разделке: обрезь, влага, кровь. Нормальные 5–15%,
      // больше — либо воруют, либо считают неверно
      lossQty: +(dto.sourceQty - outputQty).toFixed(3),
      lossPct: dto.sourceQty > 0
        ? +(((dto.sourceQty - outputQty) / dto.sourceQty) * 100).toFixed(1) : 0,
      // Проверка: сумма частей должна равняться стоимости сырья
      checkSum: rows.reduce((s, r) => s + r.cost, 0) === totalCost,
      stockQty: bal ? Number(bal.qty) : 0,
      enough: bal ? Number(bal.qty) >= dto.sourceQty : false,
    };
  }

  /** Провести разделку: списать сырьё, оприходовать части. */
  @Post()
  @RequirePermission('stock.writeoff')
  async create(@Body() dto: ButcheringDto, @Req() req: any) {
    const preview = await this.preview(dto);
    if (!preview.enough) {
      throw new BadRequestException({
        code: 'NOT_ENOUGH',
        message: `На складе ${preview.stockQty} — меньше, чем нужно ${dto.sourceQty}`,
      });
    }
    if (preview.lossPct > 30) {
      throw new BadRequestException({
        code: 'LOSS_TOO_HIGH',
        message: `Потери ${preview.lossPct}% — проверьте вес частей`,
        lossPct: preview.lossPct,
      });
    }

    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!wh) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND' });

    const last = await this.prisma.stockDoc.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const doc = await this.prisma.$transaction(async (tx) => {
      const d = await tx.stockDoc.create({
        data: {
          accountId: req.user.acc,
          locationId: wh.locationId,
          type: 'BUTCHERING',
          status: 'POSTED',
          number: (last?.number ?? 0) + 1,
          warehouseId: dto.warehouseId,
          note: dto.note ?? `Разделка: ${preview.sourceName}`,
          createdBy: req.user.sub,
          postedAt: new Date(),
          lines: {
            create: [
              // Сырьё отрицательным количеством, части положительным —
              // в одном документе видно, что во что превратилось
              { productId: dto.sourceProductId, qty: -dto.sourceQty as any,
                unitCost: preview.sourceUnitCost, role: 'SOURCE', sortOrder: 0 },
              ...preview.outputs.map((o, i) => ({
                productId: o.productId, qty: o.qty as any,
                unitCost: o.unitCost, role: 'OUTPUT', sortOrder: i + 1,
              })),
            ],
          },
        },
      });

      // Списываем сырьё
      const srcBal = await tx.stockBalance.findFirst({
        where: { warehouseId: dto.warehouseId, productId: dto.sourceProductId },
      });
      if (srcBal) {
        await tx.stockBalance.update({
          where: { id: srcBal.id },
          data: { qty: Number(srcBal.qty) - dto.sourceQty },
        });
      }
      await tx.stockMovement.create({
        data: {
          accountId: req.user.acc, warehouseId: dto.warehouseId,
          productId: dto.sourceProductId, docId: d.id,
          qtyDelta: -dto.sourceQty, unitCost: preview.sourceUnitCost,
        },
      });

      // Приходуем части по рассчитанной себестоимости
      for (const o of preview.outputs) {
        const b = await tx.stockBalance.findFirst({
          where: { warehouseId: dto.warehouseId, productId: o.productId },
        });
        const curQty = b ? Number(b.qty) : 0;
        const curAvg = b?.avgCost ?? 0;
        const nextQty = curQty + o.qty;
        const nextAvg = curQty <= 0
          ? o.unitCost
          : Math.round((curQty * curAvg + o.qty * o.unitCost) / nextQty);

        if (b) {
          await tx.stockBalance.update({
            where: { id: b.id }, data: { qty: nextQty, avgCost: nextAvg },
          });
        } else {
          await tx.stockBalance.create({
            data: { warehouseId: dto.warehouseId, productId: o.productId,
                    qty: nextQty, avgCost: nextAvg },
          });
        }

        await tx.stockMovement.create({
          data: {
            accountId: req.user.acc, warehouseId: dto.warehouseId,
            productId: o.productId, docId: d.id,
            qtyDelta: o.qty, unitCost: o.unitCost,
          },
        });
      }

      return d;
    });

    return {
      ok: true, docId: doc.id, number: doc.number,
      outputs: preview.outputs.length,
      lossPct: preview.lossPct,
    };
  }

  /**
   * История разделок: средний выход по каждому сырью.
   * Технолог видит норму и замечает, когда мясник стал давать меньше.
   */
  @Get('history')
  @RequirePermission('stock.supply')
  async history(@Req() req: any, @Query('productId') productId?: string) {
    const docs = await this.prisma.stockDoc.findMany({
      where: { accountId: req.user.acc, type: 'BUTCHERING', status: 'POSTED' },
      include: { lines: true },
      orderBy: { postedAt: 'desc' },
      take: 50,
    });

    return docs
      .filter((d) => !productId || d.lines.some((l) => l.productId === productId && Number(l.qty) < 0))
      .map((d) => {
        const src = d.lines.find((l) => Number(l.qty) < 0);
        const outs = d.lines.filter((l) => Number(l.qty) > 0);
        const inQty = Math.abs(Number(src?.qty ?? 0));
        const outQty = outs.reduce((s, l) => s + Number(l.qty), 0);
        return {
          docId: d.id, number: d.number, at: d.postedAt,
          sourceQty: inQty, outputQty: +outQty.toFixed(3),
          lossPct: inQty > 0 ? +(((inQty - outQty) / inQty) * 100).toFixed(1) : 0,
        };
      });
  }

  // ═══════════════ ПЕРЕСОРТИЦА ═══════════════

  /**
   * Пересортица: списали не тот сорт, нашли излишек другого.
   * Классика инвентаризации — кладовщик взял пачку риса «Басмати»
   * вместо «Жасмин», в учёте минус одного и плюс другого.
   *
   * Проводим одним документом: иначе в истории останутся два
   * несвязанных движения, и через месяц никто не поймёт причину.
   */
  @Post('regrading')
  @RequirePermission('stock.writeoff')
  async regrading(
    @Body() dto: {
      warehouseId: string;
      fromProductId: string;
      toProductId: string;
      qty: number;
      reason?: string;
    },
    @Req() req: any,
  ) {
    if (dto.fromProductId === dto.toProductId) {
      throw new BadRequestException({ code: 'SAME_PRODUCT' });
    }
    if (dto.qty <= 0) throw new BadRequestException({ code: 'BAD_QTY' });

    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!wh) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND' });

    const [fromBal, toBal, products] = await Promise.all([
      this.prisma.stockBalance.findFirst({
        where: { warehouseId: dto.warehouseId, productId: dto.fromProductId },
      }),
      this.prisma.stockBalance.findFirst({
        where: { warehouseId: dto.warehouseId, productId: dto.toProductId },
      }),
      this.prisma.product.findMany({
        where: { id: { in: [dto.fromProductId, dto.toProductId] } },
        select: { id: true, name: true, unit: true },
      }),
    ]);

    const nameBy = new Map(products.map((p) => [p.id, p] as const));
    const fromUnit = nameBy.get(dto.fromProductId)?.unit;
    const toUnit = nameBy.get(dto.toProductId)?.unit;

    // Единицы должны совпадать: килограммы в литры не пересортишь,
    // и попытка означает ошибку выбора товара
    if (fromUnit !== toUnit) {
      throw new BadRequestException({
        code: 'UNIT_MISMATCH',
        message: `Разные единицы: ${fromUnit} и ${toUnit}`,
      });
    }

    // Себестоимость переносим с исходного товара: пересортица
    // не создаёт и не уничтожает стоимость, только меняет владельца
    const unitCost = fromBal?.avgCost ?? 0;

    const last = await this.prisma.stockDoc.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const doc = await tx.stockDoc.create({
        data: {
          accountId: req.user.acc,
          locationId: wh.locationId,
          type: 'SURPLUS',
          status: 'POSTED',
          number: (last?.number ?? 0) + 1,
          warehouseId: dto.warehouseId,
          reason: dto.reason ?? 'Пересортица',
          note: `${nameBy.get(dto.fromProductId)?.name} → ${nameBy.get(dto.toProductId)?.name}`,
          createdBy: req.user.sub,
          postedAt: new Date(),
          lines: {
            create: [
              { productId: dto.fromProductId, qty: -dto.qty as any,
                unitCost, role: 'FROM', sortOrder: 0 },
              { productId: dto.toProductId, qty: dto.qty as any,
                unitCost, role: 'TO', sortOrder: 1 },
            ],
          },
        },
      });

      // Списываем неверный сорт
      if (fromBal) {
        await tx.stockBalance.update({
          where: { id: fromBal.id },
          data: { qty: Number(fromBal.qty) - dto.qty },
        });
      }
      await tx.stockMovement.create({
        data: {
          accountId: req.user.acc, warehouseId: dto.warehouseId,
          productId: dto.fromProductId, docId: doc.id,
          qtyDelta: -dto.qty, unitCost,
        },
      });

      // Приходуем верный по той же цене
      const curQty = toBal ? Number(toBal.qty) : 0;
      const curAvg = toBal?.avgCost ?? 0;
      const nextQty = curQty + dto.qty;
      const nextAvg = curQty <= 0
        ? unitCost
        : Math.round((curQty * curAvg + dto.qty * unitCost) / nextQty);

      if (toBal) {
        await tx.stockBalance.update({
          where: { id: toBal.id }, data: { qty: nextQty, avgCost: nextAvg },
        });
      } else {
        await tx.stockBalance.create({
          data: { warehouseId: dto.warehouseId, productId: dto.toProductId,
                  qty: nextQty, avgCost: nextAvg },
        });
      }
      await tx.stockMovement.create({
        data: {
          accountId: req.user.acc, warehouseId: dto.warehouseId,
          productId: dto.toProductId, docId: doc.id,
          qtyDelta: dto.qty, unitCost,
        },
      });
    });

    return {
      ok: true,
      from: nameBy.get(dto.fromProductId)?.name,
      to: nameBy.get(dto.toProductId)?.name,
      qty: dto.qty,
      unitCost,
    };
  }
}

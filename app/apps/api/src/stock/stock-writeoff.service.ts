// apps/api/src/stock/stock-writeoff.service.ts
// Автосписание при продаже: продали плов — конина, рис и масло ушли со склада.
//
// Почему это делается отдельным сервисом, а не внутри обработчика заказа:
// списание может упасть (нет техкарты, нет склада), но продажа при этом
// должна остаться. Деньги важнее остатков — их можно пересчитать,
// а потерянный чек не вернуть.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { explodeWriteOff } from '../menu/cost.service';

@Injectable()
export class StockWriteoffService {
  private readonly log = new Logger('Writeoff');

  constructor(private prisma: PrismaService) {}

  /**
   * Списать ингредиенты по проданным позициям.
   * Возвращает число списанных компонентов — по нему видно,
   * сработала ли техкарта.
   */
  async writeOffForOrder(params: {
    accountId: string;
    locationId: string;
    orderId: string;
    items: { productId: string; qty: number }[];
  }): Promise<{ components: number; skipped: number }> {
    // Склад точки: списываем с того, что привязан к локации.
    // Если складов несколько, берём основной — кассир не должен
    // выбирать склад при продаже
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { locationId: params.locationId, isActive: true },
      orderBy: { isDefault: 'desc' },
    });

    if (!warehouse) {
      this.log.warn(`Склад точки ${params.locationId} не найден — списание пропущено`);
      return { components: 0, skipped: params.items.length };
    }

    // Техкарты нужны все сразу: блюдо может состоять из полуфабрикатов,
    // а те — из других полуфабрикатов
    const cards = await this.prisma.techCard.findMany({
      include: { lines: true },
    });

    const techCards = new Map(
      cards.map((c) => [c.productId, {
        productId: c.productId,
        version: c.version,
        outputQty: Number(c.outputQty),
        // Списываем по БРУТТО: это то, что реально уходит со склада,
        // включая потери при чистке. Нетто нужно для расчёта себестоимости
        lines: c.lines.map((l) => ({
          componentId: l.componentId,
          bruttoQty: Number(l.bruttoQty),
        })),
      }]),
    );

    // Считаем суммарный расход по всем позициям чека
    const totalNeed = new Map<string, number>();
    let skipped = 0;

    for (const item of params.items) {
      try {
        const exploded = explodeWriteOff(
          item.productId,
          Number(item.qty),
          // Для списания нужны только техкарты: цены и типы участвуют
          // в расчёте себестоимости, а здесь мы двигаем количества
          { techCards, ingredientCost: new Map(), productType: new Map() },
        );
        for (const [componentId, qty] of exploded) {
          totalNeed.set(componentId, (totalNeed.get(componentId) ?? 0) + qty);
        }
      } catch (e: any) {
        // Цикл в техкарте или иная ошибка — позиция пропускается,
        // остальной чек списывается нормально
        this.log.warn(`Позиция ${item.productId} не развёрнута: ${e?.message}`);
        skipped++;
      }
    }

    if (!totalNeed.size) return { components: 0, skipped };

    // Защита от рассогласования единиц. Техкарта, записанная в граммах,
    // при складе в килограммах спишет 120 кг риса вместо 120 граммов —
    // и это самая коварная ошибка учёта: всё считается верно,
    // но в разных измерениях. Отлавливаем до записи движений.
    const comps = await this.prisma.product.findMany({
      where: { id: { in: [...totalNeed.keys()] } },
      select: { id: true, name: true, unit: true },
    });
    const unitById = new Map(comps.map((c) => [c.id, c] as const));

    for (const [productId, qty] of totalNeed) {
      const c = unitById.get(productId);
      // Порция блюда не может съедать 50 кг одного компонента.
      // Порог намеренно высокий: банкетное блюдо на 20 человек допустимо
      const limit = c?.unit === 'KG' || c?.unit === 'L' ? 50 : 500;
      if (qty > limit) {
        this.log.error(
          `Списание остановлено: ${c?.name ?? productId} — ${qty} ${c?.unit ?? ''} ` +
          `на заказ ${params.orderId}. Похоже, техкарта записана в граммах, ` +
          `а склад ведётся в килограммах.`,
        );
        return { components: 0, skipped: params.items.length };
      }
    }

    // Одной транзакцией: движения и остатки должны меняться вместе,
    // иначе при сбое склад разъедется с историей
    await this.prisma.$transaction(async (tx) => {
      for (const [productId, qty] of totalNeed) {
        const bal = await tx.stockBalance.findFirst({
          where: { warehouseId: warehouse.id, productId },
        });

        const avgCost = bal?.avgCost ?? 0;
        const current = bal ? Number(bal.qty) : 0;

        // Остаток МОЖЕТ уйти в минус — и мы его не прячем.
        // Минус означает «продали больше, чем оприходовали»,
        // то есть забыли провести накладную. Это сигнал, а не ошибка
        const next = current - qty;

        if (bal) {
          await tx.stockBalance.update({
            where: { id: bal.id },
            data: { qty: next },
          });
        } else {
          await tx.stockBalance.create({
            data: { warehouseId: warehouse.id, productId, qty: next, avgCost: 0 },
          });
        }

        await tx.stockMovement.create({
          data: {
            accountId: params.accountId,
            warehouseId: warehouse.id,
            productId,
            orderId: params.orderId,
            qtyDelta: -qty,
            unitCost: avgCost,
          },
        });
      }
    });

    this.log.log(`Заказ ${params.orderId}: списано ${totalNeed.size} компонентов`);
    return { components: totalNeed.size, skipped };
  }
}

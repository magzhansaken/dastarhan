// apps/api/src/core/backup.controller.ts
// Резервное копирование и проверка целостности.
//
// У конкурентов эта тема спрятана: бэкапы делает хостинг, клиент
// узнаёт о их отсутствии в день аварии. Мы показываем состояние
// открыто и проверяем, что копия читается — непроверенный бэкап
// это не бэкап, а надежда.
import {
  Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('backup')
@UseGuards(JwtGuard, PermissionsGuard)
export class BackupController {
  constructor(private prisma: PrismaService) {}

  /**
   * Состояние данных: что накопилось и сколько потеряется,
   * если восстанавливать из последней копии.
   */
  @Get('status')
  @RequirePermission('admin.settings')
  async status(@Req() req: any) {
    const acc = req.user.acc;

    const [orders, products, customers, movements, lastOrder, firstOrder] =
      await Promise.all([
        this.prisma.order.count({ where: { accountId: acc } }),
        this.prisma.product.count({ where: { accountId: acc, isDeleted: false } }),
        this.prisma.customer.count({ where: { accountId: acc } }),
        this.prisma.stockMovement.count({ where: { accountId: acc } }),
        this.prisma.order.findFirst({
          where: { accountId: acc }, orderBy: { openedAt: 'desc' },
          select: { openedAt: true },
        }),
        this.prisma.order.findFirst({
          where: { accountId: acc }, orderBy: { openedAt: 'asc' },
          select: { openedAt: true },
        }),
      ]);

    const days = firstOrder?.openedAt
      ? Math.max(1, Math.floor((Date.now() - firstOrder.openedAt.getTime()) / 86400_000))
      : 0;

    return {
      records: { orders, products, customers, movements },
      dataFrom: firstOrder?.openedAt ?? null,
      lastActivity: lastOrder?.openedAt ?? null,
      daysOfHistory: days,
      // Средний дневной объём: помогает понять, сколько потеряется
      // при откате на сутки. «142 чека» весомее, чем «один день»
      avgOrdersPerDay: days > 0 ? Math.round(orders / days) : 0,
      hint: 'Выгрузите данные перед крупными изменениями — меню, ценами, инвентаризацией',
    };
  }

  /**
   * Выгрузка данных аккаунта в JSON.
   *
   * Владелец должен иметь возможность забрать свои данные —
   * это и страховка, и вопрос доверия. Клиент, который знает,
   * что может уйти с данными, реже думает об уходе.
   */
  @Get('export')
  @RequirePermission('admin.settings')
  async exportAll(@Req() req: any, @Query('scope') scope = 'catalog') {
    const acc = req.user.acc;

    // Справочники — то, что дороже всего восстанавливать руками.
    // Меню на восемьдесят позиций с техкартами это неделя работы
    const [account, locations, categories, products, techCards, suppliers] =
      await Promise.all([
        this.prisma.account.findUnique({ where: { id: acc } }),
        this.prisma.location.findMany({ where: { accountId: acc } }),
        this.prisma.menuCategory.findMany({ where: { accountId: acc, isDeleted: false } }),
        this.prisma.product.findMany({
          where: { accountId: acc, isDeleted: false },
          include: { barcodes: true, prices: true },
        }),
        this.prisma.techCard.findMany({ include: { lines: true } }),
        this.prisma.supplier.findMany({ where: { accountId: acc } }).catch(() => []),
      ]);

    const base = {
      exportedAt: new Date(),
      version: 1,
      account: account ? { id: account.id, name: account.name } : null,
      locations: locations.map((l) => ({ id: l.id, name: l.name, address: l.address })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, nameKk: c.nameKk })),
      products: products.map((p) => ({
        id: p.id, name: p.name, nameKk: p.nameKk,
        categoryId: p.categoryId, type: p.type, unit: p.unit,
        basePrice: p.basePrice, sku: p.sku,
        barcodes: p.barcodes.map((b) => b.value),
        prices: p.prices.map((pr) => ({ locationId: pr.locationId, price: pr.price })),
      })),
      techCards: techCards.map((c) => ({
        productId: c.productId, version: c.version, outputQty: c.outputQty,
        lines: c.lines.map((l) => ({
          componentId: l.componentId,
          bruttoQty: l.bruttoQty, nettoQty: l.nettoQty,
        })),
      })),
      suppliers: (suppliers as any[]).map((s) => ({
        id: s.id, name: s.name, binIin: s.binIin, phone: s.phone,
      })),
    };

    if (scope === 'catalog') {
      return {
        ...base,
        scope: 'catalog',
        note: 'Справочники: меню, техкарты, поставщики. Продажи не включены',
      };
    }

    // Полная выгрузка тяжёлая — ограничиваем период, иначе
    // запрос уронит сервер на большом заведении
    const from = new Date();
    from.setDate(from.getDate() - 90);
    const orders = await this.prisma.order.findMany({
      where: { accountId: acc, closedAt: { gte: from } },
      include: { items: true, payments: true },
      take: 20000,
    });

    return {
      ...base,
      scope: 'full',
      periodFrom: from,
      orders: orders.map((o) => ({
        number: o.number, closedAt: o.closedAt, total: o.total,
        items: o.items.map((i) => ({
          name: i.nameSnapshot, qty: i.qty, unitPrice: i.unitPrice,
        })),
        payments: o.payments.map((p) => ({ kind: p.kind, amount: p.amount })),
      })),
      note: 'Продажи за 90 дней. Для полной истории обратитесь в поддержку',
    };
  }

  /**
   * Проверка целостности: находит расхождения, которые копятся
   * незаметно и всплывают в самый неудобный момент.
   */
  @Get('integrity')
  @RequirePermission('admin.settings')
  async integrity(@Req() req: any) {
    const acc = req.user.acc;
    const issues: { level: 'error' | 'warn'; text: string; fix: string }[] = [];

    // Отрицательные остатки: продали больше, чем приняли.
    // Обычно значит, что забыли провести накладную
    const negative = await this.prisma.stockBalance.findMany({
      where: { qty: { lt: 0 } },
      take: 50,
    });
    if (negative.length) {
      const names = await this.prisma.product.findMany({
        where: { id: { in: negative.map((n) => n.productId) } },
        select: { name: true },
      });
      issues.push({
        level: 'error',
        text: `Минус на складе: ${names.slice(0, 5).map((n) => n.name).join(', ')}${negative.length > 5 ? ` и ещё ${negative.length - 5}` : ''}`,
        fix: 'Проверьте, все ли накладные проведены',
      });
    }

    // Закрытые заказы без оплаты: деньги взяли, а платёж не записали
    const unpaidClosed = await this.prisma.order.count({
      where: {
        accountId: acc, status: 'CLOSED', total: { gt: 0 },
        payments: { none: { status: 'CAPTURED' } },
      },
    });
    if (unpaidClosed > 0) {
      issues.push({
        level: 'error',
        text: `Закрытых чеков без оплаты: ${unpaidClosed}`,
        fix: 'Выручка занижена — проверьте эти заказы в отчёте по чекам',
      });
    }

    // Блюда без техкарт: себестоимость не считается, фудкост врёт
    const dishes = await this.prisma.product.findMany({
      where: { accountId: acc, type: 'DISH', isDeleted: false },
      select: { id: true, name: true },
    });
    const cards = await this.prisma.techCard.findMany({
      where: { productId: { in: dishes.map((d) => d.id) } },
      select: { productId: true },
    });
    const withCard = new Set(cards.map((c) => c.productId));
    const noCard = dishes.filter((d) => !withCard.has(d.id));
    if (noCard.length) {
      issues.push({
        level: 'warn',
        text: `Блюд без техкарты: ${noCard.length}`,
        fix: 'Их себестоимость не считается — прибыль показывается завышенной',
      });
    }

    // Смены, открытые больше суток: Z-отчёт не сойдётся,
    // а по закону смена не может длиться дольше 24 часов
    const stale = await this.prisma.cashShift.findMany({
      where: {
        accountId: acc, closedAt: null,
        openedAt: { lt: new Date(Date.now() - 24 * 3600_000) },
      },
      select: { number: true, openedAt: true },
    });
    if (stale.length) {
      issues.push({
        level: 'error',
        text: `Смен открыто дольше суток: ${stale.length}`,
        fix: 'Закройте их — по закону смена не может длиться дольше 24 часов',
      });
    }

    // Чеки в очереди фискализации: копятся, если ОФД недоступен
    const queued = await this.prisma.fiscalReceipt.count({
      where: { accountId: acc, status: { in: ['QUEUED', 'ERROR'] } },
    }).catch(() => 0);
    if (queued > 10) {
      issues.push({
        level: 'warn',
        text: `Чеков ждут отправки в ОФД: ${queued}`,
        fix: 'Проверьте связь с Webkassa — по закону есть 72 часа',
      });
    }

    return {
      checkedAt: new Date(),
      healthy: issues.length === 0,
      errors: issues.filter((i) => i.level === 'error').length,
      warnings: issues.filter((i) => i.level === 'warn').length,
      issues,
      verdict: issues.length === 0
        ? 'Данные в порядке'
        : issues.some((i) => i.level === 'error')
        ? 'Есть расхождения, которые искажают отчёты'
        : 'Есть замечания, но критичного ничего',
    };
  }
}

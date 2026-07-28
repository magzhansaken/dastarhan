// apps/api/src/reports/export.controller.ts
// Выгрузка для бухгалтера: 1С, Excel, банковская выписка.
//
// Бухгалтер работает в своей программе и не будет заходить
// в наш бэк-офис. Его задача — получить файл раз в месяц
// и не звонить с вопросами.
import { Controller, Get, Query, Req, UseGuards, Header } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('export')
@UseGuards(JwtGuard, PermissionsGuard)
export class ExportController {
  constructor(private prisma: PrismaService) {}

  /**
   * Продажи в CSV для 1С. Точка с запятой как разделитель
   * и BOM в начале: без них Excel в Windows ломает кириллицу,
   * и бухгалтер получает кракозябры.
   */
  @Get('sales.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sales.csv"')
  @RequirePermission('finance.view')
  async salesCsv(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(new Date().setDate(1));
    const toDate = to ? new Date(to) : new Date();

    const orders = await this.prisma.order.findMany({
      where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: fromDate, lte: toDate } },
      include: { items: { where: { isRemoved: false } } },
      orderBy: { closedAt: 'asc' },
    });

    const payments = await this.prisma.payment.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
      select: { orderId: true, kind: true },
    });
    const payBy = new Map(payments.map((p) => [p.orderId, p.kind]));

    const rows = [
      'Дата;Номер;Позиция;Количество;Цена;Сумма;Оплата',
      ...orders.flatMap((o) =>
        o.items.map((i) => [
          o.closedAt!.toLocaleDateString('ru-RU'),
          o.number,
          // Кавычки в названии ломают CSV — экранируем удвоением
          `"${i.nameSnapshot.replace(/"/g, '""')}"`,
          Number(i.qty),
          (i.unitPrice / 100).toFixed(2),
          ((Number(i.qty) * i.unitPrice) / 100).toFixed(2),
          payBy.get(o.id) ?? '',
        ].join(';')),
      ),
    ];

    return '\uFEFF' + rows.join('\r\n');
  }

  /** Движение денег для сверки с банком. */
  @Get('cashflow.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cashflow.csv"')
  @RequirePermission('finance.view')
  async cashflowCsv(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(new Date().setDate(1));
    const toDate = to ? new Date(to) : new Date();

    const txs = await this.prisma.finTransaction.findMany({
      where: { accountId: req.user.acc, at: { gte: fromDate, lte: toDate } },
      orderBy: { at: 'asc' },
    });

    const cats = await this.prisma.finCategory.findMany({ where: { accountId: req.user.acc } });
    const catBy = new Map(cats.map((c) => [c.id, c.name]));

    const rows = [
      'Дата;Статья;Приход;Расход;Комментарий',
      ...txs.map((t) => [
        t.at.toLocaleDateString('ru-RU'),
        `"${(catBy.get(t.categoryId ?? '') ?? '—').replace(/"/g, '""')}"`,
        t.amount > 0 ? (t.amount / 100).toFixed(2) : '',
        t.amount < 0 ? (Math.abs(t.amount) / 100).toFixed(2) : '',
        `"${(t.note ?? '').replace(/"/g, '""')}"`,
      ].join(';')),
    ];

    return '\uFEFF' + rows.join('\r\n');
  }

  /**
   * Остатки на дату для инвентаризационной ведомости.
   * Бухгалтер сверяет с фактом при закрытии месяца.
   */
  @Get('stock.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock.csv"')
  @RequirePermission('stock.supply')
  async stockCsv(@Query('warehouseId') warehouseId?: string) {
    const balances = await this.prisma.stockBalance.findMany({
      where: warehouseId ? { warehouseId } : {},
    });

    const products = await this.prisma.product.findMany({
      where: { id: { in: balances.map((b) => b.productId) } },
      select: { id: true, name: true, unit: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const rows = [
      'Артикул;Товар;Единица;Остаток;Себестоимость;Сумма',
      ...balances.map((b) => {
        const p = byId.get(b.productId);
        return [
          p?.sku ?? '',
          `"${(p?.name ?? '—').replace(/"/g, '""')}"`,
          p?.unit ?? '',
          Number(b.qty).toFixed(3),
          (b.avgCost / 100).toFixed(2),
          ((Number(b.qty) * b.avgCost) / 100).toFixed(2),
        ].join(';');
      }),
    ];

    return '\uFEFF' + rows.join('\r\n');
  }

  /** Что можно выгрузить — для экрана в бэк-офисе. */
  @Get('list')
  @RequirePermission('finance.view')
  list() {
    return {
      note: 'Файлы открываются в Excel и загружаются в 1С',
      files: [
        { key: 'sales', label: 'Продажи по позициям', path: '/export/sales.csv',
          hint: 'для книги продаж и расчёта налога' },
        { key: 'cashflow', label: 'Движение денег', path: '/export/cashflow.csv',
          hint: 'для сверки с банковской выпиской' },
        { key: 'stock', label: 'Остатки на складе', path: '/export/stock.csv',
          hint: 'для инвентаризационной ведомости' },
      ],
      // Автоматической синхронизации с 1С нет — говорим прямо,
      // а не обещаем «интеграцию», которой не будет
      onec: 'Автоматической синхронизации с 1С пока нет — выгрузка файлом',
    };
  }
}

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

  /**
   * Книга продаж помесячно — то, что бухгалтер сдаёт в налоговую.
   *
   * У конкурентов выгрузка сырых чеков, и бухгалтер сводит их сам.
   * Мы даём готовые итоги по дням с разбивкой по способам оплаты
   * и налогу: остаётся перенести цифры в декларацию.
   */
  @Get('sales-book')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="sales-book.csv"')
  @RequirePermission('finance.view')
  async salesBook(@Req() req: any, @Query('month') month?: string) {
    const base = month ? new Date(month + '-01') : new Date();
    const from = new Date(base.getFullYear(), base.getMonth(), 1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);

    const account = await this.prisma.account.findUnique({
      where: { id: req.user.acc },
      select: { name: true, taxMode: true, turnoverTaxRate: true, vatRate: true },
    });

    const orders = await this.prisma.order.findMany({
      where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: from, lt: to } },
      // Payment не связан с Order через relation — берём отдельно
      orderBy: { closedAt: 'asc' },
    });

    // Refund привязан к платежу, а не к аккаунту напрямую —
    // берём возвраты по платежам заказов этого периода
    // Платежи заказов: Payment связан с Order только по orderId
    const pays = await this.prisma.payment.findMany({
      where: { orderId: { in: orders.map((o) => o.id) }, status: 'CAPTURED' },
      select: { orderId: true, kind: true, amount: true },
    });
    const payBy = new Map<string, { kind: string; amount: number }[]>();
    for (const p of pays) {
      const arr = payBy.get(p.orderId) ?? [];
      arr.push({ kind: p.kind, amount: p.amount });
      payBy.set(p.orderId, arr);
    }

    const refunds = await this.prisma.refund.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        payment: { orderId: { in: orders.map((o) => o.id) } },
      },
      select: { amount: true, createdAt: true },
    }).catch(() => [] as { amount: number; createdAt: Date }[]);

    // Группируем по дням: налоговая смотрит дневные итоги,
    // а не каждый чек
    const byDay = new Map<string, {
      revenue: number; checks: number;
      cash: number; card: number; qr: number; refund: number;
    }>();

    for (const o of orders) {
      const key = o.closedAt!.toISOString().slice(0, 10);
      const cur = byDay.get(key) ?? {
        revenue: 0, checks: 0, cash: 0, card: 0, qr: 0, refund: 0,
      };
      cur.revenue += o.total;
      cur.checks++;
      for (const p of payBy.get(o.id) ?? []) {
        if (p.kind === 'CASH') cur.cash += p.amount;
        else if (p.kind === 'CARD') cur.card += p.amount;
        else cur.qr += p.amount;
      }
      byDay.set(key, cur);
    }

    for (const r of refunds as any[]) {
      const key = r.createdAt.toISOString().slice(0, 10);
      const cur = byDay.get(key);
      if (cur) cur.refund += r.amount;
    }

    const taxRate = Number(account?.turnoverTaxRate ?? 3);
    const isVat = account?.taxMode === 'VAT';

    const rows = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const money = (v: number) => (v / 100).toFixed(2);

    const lines = [
      `Книга продаж;${account?.name ?? ''};${from.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`,
      '',
      isVat
        ? `Дата;Чеков;Выручка;Возвраты;Итого;Наличные;Карта;QR;НДС ${account?.vatRate ?? 16}%`
        : `Дата;Чеков;Выручка;Возвраты;Итого;Наличные;Карта;QR;Налог ${taxRate}%`,
    ];

    let totalRevenue = 0, totalRefund = 0;
    for (const [day, v] of rows) {
      const net = v.revenue - v.refund;
      totalRevenue += v.revenue;
      totalRefund += v.refund;
      // НДС считается «в том числе» — так принято в чеках РК
      const tax = isVat
        ? Math.round(net * (account?.vatRate ?? 16) / (100 + (account?.vatRate ?? 16)))
        : Math.round(net * taxRate / 100);

      lines.push([
        new Date(day).toLocaleDateString('ru-RU'),
        v.checks,
        money(v.revenue),
        money(v.refund),
        money(net),
        money(v.cash),
        money(v.card),
        money(v.qr),
        money(tax),
      ].join(';'));
    }

    const net = totalRevenue - totalRefund;
    const totalTax = isVat
      ? Math.round(net * (account?.vatRate ?? 16) / (100 + (account?.vatRate ?? 16)))
      : Math.round(net * taxRate / 100);

    lines.push('');
    lines.push(`ИТОГО;${orders.length};${money(totalRevenue)};${money(totalRefund)};${money(net)};;;;${money(totalTax)}`);

    return '\uFEFF' + lines.join('\r\n');
  }

  /**
   * Оборотно-сальдовая по складу: что было, пришло, ушло, осталось.
   * Бухгалтер сверяет её с актом инвентаризации.
   */
  @Get('stock-turnover.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock-turnover.csv"')
  @RequirePermission('finance.view')
  async stockTurnover(
    @Req() req: any,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(to.getFullYear(), to.getMonth(), 1);

    const moves = await this.prisma.stockMovement.findMany({
      where: { accountId: req.user.acc, at: { gte: from, lte: to } },
      select: { productId: true, qtyDelta: true, unitCost: true, at: true },
    });

    // Остаток на начало восстанавливаем обратным ходом от текущего:
    // отдельной таблицы истории нет, а цифра бухгалтеру нужна
    // У StockBalance нет связи product — сначала берём товары аккаунта
    const accProducts = await this.prisma.product.findMany({
      where: { accountId: req.user.acc },
      select: { id: true },
    });
    const balances = await this.prisma.stockBalance.findMany({
      where: { productId: { in: accProducts.map((p) => p.id) } },
      select: { productId: true, qty: true, avgCost: true },
    });
    const nowBy = new Map(balances.map((b) => [b.productId, Number(b.qty)]));

    const after = await this.prisma.stockMovement.findMany({
      where: { accountId: req.user.acc, at: { gt: to } },
      select: { productId: true, qtyDelta: true },
    });
    const afterBy = new Map<string, number>();
    for (const m of after) {
      afterBy.set(m.productId, (afterBy.get(m.productId) ?? 0) + Number(m.qtyDelta));
    }

    const inBy = new Map<string, number>();
    const outBy = new Map<string, number>();
    for (const m of moves) {
      const q = Number(m.qtyDelta);
      if (q > 0) inBy.set(m.productId, (inBy.get(m.productId) ?? 0) + q);
      else outBy.set(m.productId, (outBy.get(m.productId) ?? 0) + Math.abs(q));
    }

    const ids = [...new Set([...inBy.keys(), ...outBy.keys()])];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, unit: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const costBy = new Map(balances.map((b) => [b.productId, b.avgCost]));

    const lines = [
      'Артикул;Товар;Ед;Остаток на начало;Приход;Расход;Остаток на конец;Себестоимость;Сумма',
    ];

    for (const id of ids) {
      const p = byId.get(id);
      const inQty = inBy.get(id) ?? 0;
      const outQty = outBy.get(id) ?? 0;
      const now = nowBy.get(id) ?? 0;
      const afterDelta = afterBy.get(id) ?? 0;
      const end = now - afterDelta;
      const start = end - inQty + outQty;
      const cost = costBy.get(id) ?? 0;

      lines.push([
        p?.sku ?? '',
        `"${(p?.name ?? '—').replace(/"/g, '""')}"`,
        p?.unit ?? '',
        start.toFixed(3),
        inQty.toFixed(3),
        outQty.toFixed(3),
        end.toFixed(3),
        (cost / 100).toFixed(2),
        ((end * cost) / 100).toFixed(2),
      ].join(';'));
    }

    return '\uFEFF' + lines.join('\r\n');
  }

  /**
   * Сводка для бухгалтера: что сдавать и когда.
   * Даты налоговых сроков Казахстана — чтобы не пропустить.
   */
  @Get('accountant-summary')
  @RequirePermission('finance.view')
  async accountantSummary(@Req() req: any) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const account = await this.prisma.account.findUnique({
      where: { id: req.user.acc },
      select: { taxMode: true, turnoverTaxRate: true },
    });

    const [cur, prev] = await Promise.all([
      this.prisma.order.aggregate({
        where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: monthStart } },
        _sum: { total: true }, _count: true,
      }),
      this.prisma.order.aggregate({
        where: {
          accountId: req.user.acc, status: 'CLOSED',
          closedAt: { gte: prevStart, lt: monthStart },
        },
        _sum: { total: true },
      }),
    ]);

    const revenue = cur._sum.total ?? 0;
    const prevRevenue = prev._sum.total ?? 0;
    const rate = Number(account?.turnoverTaxRate ?? 3);

    // Квартальные сроки: упрощёнка сдаёт форму 910 раз в полгода,
    // но налог платит ежеквартально
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const nextQuarterEnd = new Date(now.getFullYear(), quarter * 3, 0);
    const payDeadline = new Date(nextQuarterEnd);
    payDeadline.setDate(payDeadline.getDate() + 25);

    return {
      taxMode: account?.taxMode ?? 'SIMPLIFIED',
      currentMonth: {
        revenue,
        checks: cur._count,
        estimatedTax: Math.round(revenue * rate / 100),
      },
      previousMonth: {
        revenue: prevRevenue,
        estimatedTax: Math.round(prevRevenue * rate / 100),
      },
      quarter,
      quarterEnds: nextQuarterEnd,
      payTaxBy: payDeadline,
      daysToPay: Math.ceil((payDeadline.getTime() - now.getTime()) / 86400_000),
      files: [
        { key: 'sales-book', label: 'Книга продаж', path: '/export/sales-book' },
        { key: 'turnover', label: 'Оборотно-сальдовая по складу', path: '/export/stock-turnover.csv' },
        { key: 'cashflow', label: 'Движение денег', path: '/export/cashflow.csv' },
      ],
      // Напоминание за неделю: штраф за просрочку больше,
      // чем сумма налога у маленького кафе
      reminder: Math.ceil((payDeadline.getTime() - now.getTime()) / 86400_000) <= 7
        ? `Налог за квартал платить до ${payDeadline.toLocaleDateString('ru-RU')}`
        : null,
    };
  }
}

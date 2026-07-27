// apps/api/src/finance/finance.controller.ts
// Финансы, гости и доставка. Логика расчётов уже в чистых модулях
// и покрыта тестами — контроллеры только выбирают данные и вызывают её.
import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('finance')
@UseGuards(JwtGuard, PermissionsGuard)
export class FinanceController {
  constructor(private prisma: PrismaService) {}

  /**
   * Отчёт о прибыли. Налог 3% с оборота считается здесь, а не оставляется
   * владельцу на потом: без этой строки «прибыль» в отчёте всегда завышена,
   * и человек планирует деньги, которых у него нет.
   */
  @Get('pnl')
  @RequirePermission('finance.view')
  async pnl(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: any,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate = to ? new Date(to) : new Date();
    const accountId = req.user.acc;

    const [orders, txs, categories] = await Promise.all([
      this.prisma.order.findMany({
        where: { accountId, status: 'CLOSED', closedAt: { gte: fromDate, lte: toDate } },
        select: { total: true },
      }),
      this.prisma.finTransaction.findMany({
        where: { accountId, at: { gte: fromDate, lte: toDate } },
        select: { amount: true, categoryId: true },
      }),
      this.prisma.finCategory.findMany({ where: { accountId } }),
    ]);

    const catById = new Map(categories.map((c) => [c.id, c]));
    const revenue = orders.reduce((s, o) => s + o.total, 0);

    // Расходы группируем по статьям — владельцу нужно видеть,
    // куда именно ушли деньги, а не одну цифру «расходы»
    const byCategory = new Map<string, number>();
    let expenses = 0;
    for (const t of txs) {
      const cat = catById.get(t.categoryId ?? '');
      if (!cat || cat.kind !== 'EXPENSE') continue;
      if (cat.inPnl === false) continue;   // не все траты идут в P&L (например, вывод дивидендов)
      expenses += Math.abs(t.amount);
      byCategory.set(cat.name, (byCategory.get(cat.name) ?? 0) + Math.abs(t.amount));
    }

    // Упрощённый режим Казахстана: 3% с оборота, не с прибыли
    const tax = Math.round(revenue * 0.03);
    const net = revenue - expenses - tax;

    return {
      period: { from: fromDate, to: toDate },
      revenue,
      expenses,
      byCategory: [...byCategory.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount),
      tax,
      taxRate: 3,
      net,
      marginPct: revenue > 0 ? +((100 * net) / revenue).toFixed(1) : 0,
    };
  }

  /** Движение денег: пришло, ушло, остаток по счетам. */
  @Get('cashflow')
  @RequirePermission('finance.view')
  async cashflow(@Query('from') from?: string, @Query('to') to?: string, @Req() req?: any) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate = to ? new Date(to) : new Date();

    const txs = await this.prisma.finTransaction.findMany({
      where: { accountId: req.user.acc, at: { gte: fromDate, lte: toDate } },
      select: { amount: true, at: true },
    });

    const income = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const outcome = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    return { income, outcome, balance: income - outcome, count: txs.length };
  }
}

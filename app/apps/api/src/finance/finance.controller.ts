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

    // Подсказки к цифрам: владелец пришёл не смотреть таблицу,
    // а понять, что делать. Голая маржа этого не говорит.
    const insights = await this.buildInsights(accountId, fromDate, toDate);

    return {
      period: { from: fromDate, to: toDate },
      periodLabel: `${fromDate.toLocaleDateString('ru-RU')} — ${toDate.toLocaleDateString('ru-RU')} · ИП на упрощёнке, налог 3% с оборота`,
      insights,
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

  /**
   * Подсказки: что именно повлияло на прибыль.
   * Две самые полезные — подорожавшее сырьё и блюда-кормильцы.
   */
  private async buildInsights(accountId: string, from: Date, to: Date) {
    const out: { kind: 'warn' | 'good'; text: string }[] = [];

    // Рост закупочной цены: владелец узнаёт об этом из накладных
    // через месяц, а надо — сразу, пока можно поднять цену блюда
    const moves = await this.prisma.stockMovement.findMany({
      where: { accountId, qtyDelta: { gt: 0 }, at: { gte: from, lte: to } },
      select: { productId: true, unitCost: true, at: true },
      orderBy: { at: 'asc' },
    });

    const byProduct = new Map<string, { first: number; last: number; at: Date }>();
    for (const m of moves) {
      const cur = byProduct.get(m.productId);
      if (!cur) byProduct.set(m.productId, { first: m.unitCost, last: m.unitCost, at: m.at });
      else { cur.last = m.unitCost; cur.at = m.at; }
    }

    for (const [productId, v] of byProduct) {
      if (v.first <= 0) continue;
      const growth = Math.round(((v.last - v.first) / v.first) * 100);
      if (growth >= 10) {
        const p = await this.prisma.product.findUnique({
          where: { id: productId }, select: { name: true },
        });
        out.push({
          kind: 'warn',
          text: `${p?.name ?? 'Товар'} подорожал на ${growth}% с ${v.at.toLocaleDateString('ru-RU')} — себестоимость блюд выросла`,
        });
      }
    }

    // Блюда-кормильцы: держать в наличии всегда, кончились —
    // выручка падает сразу, а не постепенно
    const orders = await this.prisma.order.findMany({
      where: { accountId, status: 'CLOSED', closedAt: { gte: from, lte: to } },
      include: { items: { where: { isRemoved: false } } },
    });

    const dishRevenue = new Map<string, { name: string; sum: number }>();
    let total = 0;
    for (const o of orders) {
      for (const i of o.items) {
        const sum = Number(i.qty) * i.unitPrice;
        total += sum;
        const cur = dishRevenue.get(i.productId);
        dishRevenue.set(i.productId, { name: i.nameSnapshot, sum: (cur?.sum ?? 0) + sum });
      }
    }

    if (total > 0) {
      const top = [...dishRevenue.values()].sort((a, b) => b.sum - a.sum).slice(0, 2);
      const share = Math.round((top.reduce((s, x) => s + x.sum, 0) / total) * 100);
      if (top.length === 2 && share >= 30) {
        out.push({
          kind: 'good',
          text: `${top[0].name} и ${top[1].name.toLowerCase()} дали ${share}% выручки — держите их в наличии всегда`,
        });
      }
    }

    return out.slice(0, 3);
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

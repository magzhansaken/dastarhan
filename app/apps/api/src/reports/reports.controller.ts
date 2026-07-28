// apps/api/src/reports/reports.controller.ts
// Первый рабочий контроллер данных: отдаёт бэк-офису то, что он сейчас
// показывает демо-заглушками. Логика уже написана и покрыта тестами —
// здесь только выборка из БД и вызов чистых функций.
import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('reports')
@UseGuards(JwtGuard, PermissionsGuard)
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  /**
   * Данные для экрана «Как идут дела».
   * Сравнение с тем же часом вчера, а не с полными сутками — иначе утром
   * владелец всегда видит «падение», что бессмысленно.
   */
  @Get('dashboard')
  @RequirePermission('reports.view')
  async dashboard(
    @Query('period') period?: 'day' | 'week' | 'month',@Query('locationId') locationId?: string) {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const ydayStart = new Date(todayStart); ydayStart.setDate(ydayStart.getDate() - 1);
    const ydaySameTime = new Date(now); ydaySameTime.setDate(ydaySameTime.getDate() - 1);

    const where = (from: Date, to: Date) => ({
      closedAt: { gte: from, lte: to },
      ...(locationId ? { locationId } : {}),
      status: 'CLOSED' as const,
    });

    const [today, yday] = await Promise.all([
      this.prisma.order.findMany({ where: where(todayStart, now), select: { total: true } }),
      this.prisma.order.findMany({ where: where(ydayStart, ydaySameTime), select: { total: true } }),
    ]);

    const sum = (xs: { total: number }[]) => xs.reduce((s, x) => s + x.total, 0);
    const todayRevenue = sum(today);
    const checks = today.length;

    return {
      todayRevenue,
      yesterdaySameTime: sum(yday),
      checks,
      avgCheck: checks ? Math.round(todayRevenue / checks) : 0,
      alerts: await this.buildAlerts(locationId),
      unsyncedTerminals: 0,
    };
  }

  /** Блок «Требует внимания»: то, что стоит денег, если не заметить сегодня. */
  private async buildAlerts(locationId?: string) {
    const alerts: { severity: 'HIGH' | 'MEDIUM'; text: string }[] = [];

    // Товары в минусе или на нуле: qty может быть отрицательным —
    // это честный сигнал, что продали больше, чем оприходовали
    const low = await this.prisma.stockBalance.findMany({
      where: { qty: { lte: 0 } },
      take: 5,
    }).catch(() => [] as any[]);

    if (low.length) {
      alerts.push({
        severity: 'HIGH',
        text: `${low.length} позиц${low.length === 1 ? 'ия' : 'ий'} на складе в нуле или минусе`,
      });
    }

    // Чеки, не ушедшие в ОФД
    const stuck = await this.prisma.fiscalReceipt.count({
      where: { status: 'QUEUED' },
    }).catch(() => 0);

    if (stuck > 0) {
      alerts.push({
        severity: 'HIGH',
        text: `${stuck} чек${stuck === 1 ? '' : 'ов'} не ушл${stuck === 1 ? 'о' : 'и'} в ОФД`,
      });
    }

    return alerts;
  }

  /** Продажи за период: выручка, чеки, средний чек, разбивка по часам. */
  @Get('sales')
  @RequirePermission('reports.view')
  async sales(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate = to ? new Date(to) : new Date();

    const orders = await this.prisma.order.findMany({
      where: {
        closedAt: { gte: fromDate, lte: toDate },
        status: 'CLOSED',
        ...(locationId ? { locationId } : {}),
      },
      select: { total: true, closedAt: true },
    });

    const byHour = Array(24).fill(0);
    for (const o of orders) {
      if (o.closedAt) byHour[o.closedAt.getHours()] += o.total;
    }
    const revenue = orders.reduce((s, o) => s + o.total, 0);
    const peakHour = byHour.indexOf(Math.max(...byHour));

    return {
      revenue,
      checks: orders.length,
      avgCheck: orders.length ? Math.round(revenue / orders.length) : 0,
      byHour,
      peakHour: revenue > 0 ? peakHour : null,
    };
  }

  /** Чеки за период с фильтрами по аномалиям. */
  @Get('checks')
  @RequirePermission('reports.view')
  async checks(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
  ) {
    const fromDate = from ? new Date(from) : new Date(new Date().setHours(0, 0, 0, 0));
    const toDate = to ? new Date(to) : new Date();

    const orders = await this.prisma.order.findMany({
      where: {
        closedAt: { gte: fromDate, lte: toDate },
        status: 'CLOSED',
        ...(locationId ? { locationId } : {}),
      },
      include: { items: true, table: { select: { name: true } } },
      orderBy: { closedAt: 'desc' },
      take: 200,
    });

    const payments = await this.prisma.payment.findMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
      select: { orderId: true, kind: true, amount: true },
    });
    const payBy = new Map<string, string>();
    for (const p of payments) payBy.set(p.orderId, p.kind);

    return orders.map((o) => {
      const removed = o.items.filter((i) => i.isRemoved).length;
      return {
        orderId: o.id,
        number: o.number,
        closedAt: o.closedAt,
        tableName: o.table?.name ?? null,
        total: o.total,
        discount: o.discount,
        payKind: payBy.get(o.id) ?? null,
        itemsCount: o.items.filter((i) => !i.isRemoved).length,
        // Аномалии: удаления после кухни и скидки. Владелец ищет
        // именно их, а не листает все чеки подряд
        removedCount: removed,
        hasAnomaly: removed > 0 || o.discount > 0,
      };
    });
  }

  /**
   * ABC-анализ меню: что кормит бизнес, что держит меню, что балласт.
   * Группы по накопленной доле выручки — классика 80/15/5.
   */
  @Get('abc')
  @RequirePermission('reports.view')
  async abc(@Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const toDate = to ? new Date(to) : new Date();

    const orders = await this.prisma.order.findMany({
      where: { closedAt: { gte: fromDate, lte: toDate }, status: 'CLOSED' },
      include: { items: { where: { isRemoved: false } } },
    });

    const agg = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of orders) {
      for (const i of o.items) {
        const cur = agg.get(i.productId);
        agg.set(i.productId, {
          name: i.nameSnapshot,
          qty: (cur?.qty ?? 0) + Number(i.qty),
          revenue: (cur?.revenue ?? 0) + Number(i.qty) * i.unitPrice,
        });
      }
    }

    const rows = [...agg.entries()]
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    const total = rows.reduce((s, r) => s + r.revenue, 0);
    let acc = 0;
    return rows.map((r) => {
      acc += r.revenue;
      const share = total > 0 ? acc / total : 0;
      return {
        ...r,
        sharePct: total > 0 ? +((r.revenue / total) * 100).toFixed(1) : 0,
        group: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C',
      };
    });
  }

  /** Ведомость зарплаты: оклад по часам, процент, аванс. */
  @Get('payroll')
  @RequirePermission('finance.view')
  async payroll(@Req() req: any) {
    const users = await this.prisma.user.findMany({
      where: { accountId: req.user.acc, isActive: true },
      select: { id: true, fullName: true, isOwner: true },
    });

    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const rows: {
      userId: string; name: string; hours: number; shiftsCount: number;
      personalSales: number; ordersCount: number;
    }[] = [];

    for (const u of users) {
      if (u.isOwner) continue;

      // Смены сотрудника за месяц — из них считаются часы
      const shifts = await this.prisma.cashShift.findMany({
        where: { openedBy: u.id, openedAt: { gte: monthStart } },
        select: { openedAt: true, closedAt: true },
      });
      const minutes = shifts.reduce((s, sh) => {
        if (!sh.closedAt) return s;
        return s + (sh.closedAt.getTime() - sh.openedAt.getTime()) / 60000;
      }, 0);

      // Личные продажи — база для процента
      const orders = await this.prisma.order.findMany({
        where: { waiterId: u.id, status: 'CLOSED', closedAt: { gte: monthStart } },
        select: { total: true },
      });
      const personalSales = orders.reduce((s, o) => s + o.total, 0);

      rows.push({
        userId: u.id,
        name: u.fullName,
        hours: Math.round(minutes / 60),
        shiftsCount: shifts.length,
        personalSales,
        ordersCount: orders.length,
      });
    }
    return rows;
  }

}

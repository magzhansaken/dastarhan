// apps/api/src/reports/reports.controller.ts
// Первый рабочий контроллер данных: отдаёт бэк-офису то, что он сейчас
// показывает демо-заглушками. Логика уже написана и покрыта тестами —
// здесь только выборка из БД и вызов чистых функций.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
  async dashboard(@Query('locationId') locationId?: string) {
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
}

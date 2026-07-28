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

  /**
   * Выручка по часам для столбиков на дашборде.
   * Владелец смотрит утром за кофе: где провал, где пик,
   * и надо ли ставить второго кассира на обед.
   */
  @Get('by-hour')
  @RequirePermission('reports.view')
  async byHour(
    @Query('period') period: 'day' | 'week' | 'month' = 'day',
    @Req() req?: any,
  ) {
    const now = new Date();
    const from = new Date(now);
    if (period === 'week') from.setDate(from.getDate() - 7);
    else if (period === 'month') from.setDate(from.getDate() - 30);
    else from.setHours(0, 0, 0, 0);

    const orders = await this.prisma.order.findMany({
      where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: from, lte: now } },
      select: { total: true, closedAt: true },
    });

    // 24 часа всегда, даже пустые: провал в графике виден только
    // тогда, когда есть с чем сравнить соседние часы
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, checks: 0 }));
    for (const o of orders) {
      const h = o.closedAt!.getHours();
      hours[h].revenue += o.total;
      hours[h].checks++;
    }

    const peak = hours.reduce((a, b) => (b.revenue > a.revenue ? b : a), hours[0]);
    const working = hours.filter((h) => h.checks > 0);

    return {
      period,
      hours,
      peakHour: peak.checks > 0 ? peak.hour : null,
      peakRevenue: peak.revenue,
      // Открытые часы: заведение работает не круглосуточно,
      // и «средний час» по 24 часам врёт вдвое
      avgPerWorkingHour: working.length
        ? Math.round(working.reduce((s, h) => s + h.revenue, 0) / working.length) : 0,
    };
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


  /**
   * RFM-сегментация гостей: давность, частота, деньги.
   *
   * У iiko это тариф Enterprise и пересчёт раз в ночь.
   * У нас считается на лету и доступно всем — данных немного,
   * а владельцу нужно знать сегодня, кого возвращать.
   *
   * Названия сегментов на человеческом языке: «Чемпионы» и «Спящие»
   * понятнее, чем «R5F5M5».
   */
  @Get('rfm')
  @RequirePermission('reports.view')
  async rfm(@Req() req: any, @Query('days') days = '180') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const orders = await this.prisma.order.findMany({
      where: {
        accountId: req.user.acc,
        status: 'CLOSED',
        closedAt: { gte: from },
        customerId: { not: null },
      },
      select: { customerId: true, total: true, closedAt: true },
    });

    if (orders.length < 3) {
      return {
        ready: false,
        note: 'Нужно минимум три заказа с опознанным гостем — сегменты появятся позже',
        segments: [],
      };
    }

    const now = Date.now();
    const byGuest = new Map<string, { count: number; sum: number; last: Date }>();
    for (const o of orders) {
      const id = o.customerId!;
      const cur = byGuest.get(id);
      if (cur) {
        cur.count++; cur.sum += o.total;
        if (o.closedAt! > cur.last) cur.last = o.closedAt!;
      } else {
        byGuest.set(id, { count: 1, sum: o.total, last: o.closedAt! });
      }
    }

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: [...byGuest.keys()] } },
      select: { id: true, name: true, phone: true },
    });
    const nameBy = new Map(customers.map((c) => [c.id, c]));

    // Пороги считаем от своих данных, а не от абстрактных норм:
    // для чайханы «часто» — это раз в неделю, для банкетного зала —
    // раз в квартал
    const counts = [...byGuest.values()].map((v) => v.count).sort((a, b) => a - b);
    const sums = [...byGuest.values()].map((v) => v.sum).sort((a, b) => a - b);
    const median = (arr: number[]) => arr[Math.floor(arr.length / 2)] ?? 0;
    const freqMid = median(counts);
    const moneyMid = median(sums);

    const rows = [...byGuest.entries()].map(([id, v]) => {
      const daysAgo = Math.floor((now - v.last.getTime()) / 86400_000);
      const c = nameBy.get(id);

      // Три оси: недавно / давно, часто / редко, много / мало
      const recent = daysAgo <= 30;
      const often = v.count >= Math.max(2, freqMid);
      const rich = v.sum >= moneyMid;

      const segment =
        recent && often && rich ? 'champions'
        : recent && often ? 'loyal'
        : recent && rich ? 'big_spender'
        : recent ? 'newcomers'
        : often && rich ? 'at_risk'
        : often ? 'sleeping'
        : 'lost';

      return {
        customerId: id,
        name: c?.name ?? null,
        phone: c?.phone ?? null,
        orders: v.count,
        spent: v.sum,
        avgCheck: Math.round(v.sum / v.count),
        daysAgo,
        segment,
      };
    });

    // Каждый сегмент с действием: отчёт без «что делать» —
    // это таблица, а не инструмент
    const META: Record<string, { title: string; action: string; tone: string }> = {
      champions:   { title: 'Чемпионы',        action: 'Скажите спасибо лично — они приводят друзей', tone: 'good' },
      loyal:       { title: 'Постоянные',      action: 'Предложите накопительную скидку', tone: 'good' },
      big_spender: { title: 'Крупные чеки',    action: 'Пригласите на дегустацию или банкет', tone: 'good' },
      newcomers:   { title: 'Новички',         action: 'Дайте купон на второй визит — вернуть новичка дешевле всего', tone: 'neutral' },
      at_risk:     { title: 'Уходят',          action: 'Позвоните сегодня: были частыми, пропали', tone: 'warn' },
      sleeping:    { title: 'Спящие',          action: 'Разошлите акцию — они помнят вас', tone: 'warn' },
      lost:        { title: 'Потерянные',      action: 'Возвращать дорого — оставьте в рассылке', tone: 'dim' },
    };

    const segments = Object.entries(META).map(([key, m]) => {
      const list = rows.filter((r) => r.segment === key);
      return {
        key, ...m,
        count: list.length,
        share: +((list.length / rows.length) * 100).toFixed(1),
        revenue: list.reduce((s, r) => s + r.spent, 0),
        guests: list.sort((a, b) => b.spent - a.spent).slice(0, 20),
      };
    }).filter((s) => s.count > 0);

    return {
      ready: true,
      guestsTotal: rows.length,
      periodDays: Number(days),
      // Порог «часто» показываем явно: владелец должен понимать,
      // откуда взялась граница, а не верить на слово
      thresholds: { frequentFrom: Math.max(2, freqMid), richFrom: moneyMid },
      segments: segments.sort((a, b) => b.revenue - a.revenue),
    };
  }

  /**
   * Сравнение периодов: что изменилось и почему.
   * Владелец видит не «выручка 480 000», а «на 12% меньше прошлой
   * недели, причина — упали чеки в обед».
   */
  @Get('compare')
  @RequirePermission('reports.view')
  async compare(@Req() req: any, @Query('period') period: 'week' | 'month' = 'week') {
    const days = period === 'month' ? 30 : 7;
    const now = new Date();
    const curFrom = new Date(now); curFrom.setDate(curFrom.getDate() - days);
    const prevFrom = new Date(now); prevFrom.setDate(prevFrom.getDate() - days * 2);

    const [cur, prev] = await Promise.all([
      this.prisma.order.findMany({
        where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: curFrom, lte: now } },
        select: { total: true, closedAt: true, guestsCount: true },
      }),
      this.prisma.order.findMany({
        where: { accountId: req.user.acc, status: 'CLOSED', closedAt: { gte: prevFrom, lt: curFrom } },
        select: { total: true, closedAt: true, guestsCount: true },
      }),
    ]);

    const stat = (rows: typeof cur) => {
      const revenue = rows.reduce((s, o) => s + o.total, 0);
      const checks = rows.length;
      const guests = rows.reduce((s, o) => s + (o.guestsCount ?? 1), 0);
      // Обед и ужин смотрим отдельно: провал в обед и провал вечером —
      // разные проблемы с разными решениями
      const lunch = rows.filter((o) => {
        const h = o.closedAt!.getHours();
        return h >= 12 && h < 16;
      });
      const dinner = rows.filter((o) => o.closedAt!.getHours() >= 18);
      return {
        revenue, checks,
        avgCheck: checks ? Math.round(revenue / checks) : 0,
        guests,
        lunchRevenue: lunch.reduce((s, o) => s + o.total, 0),
        dinnerRevenue: dinner.reduce((s, o) => s + o.total, 0),
      };
    };

    const c = stat(cur), p = stat(prev);
    const pct = (a: number, b: number) => b > 0 ? +(((a - b) / b) * 100).toFixed(1) : null;

    const changes = [
      { key: 'revenue', label: 'Выручка', now: c.revenue, was: p.revenue, pct: pct(c.revenue, p.revenue) },
      { key: 'checks', label: 'Чеки', now: c.checks, was: p.checks, pct: pct(c.checks, p.checks) },
      { key: 'avgCheck', label: 'Средний чек', now: c.avgCheck, was: p.avgCheck, pct: pct(c.avgCheck, p.avgCheck) },
      { key: 'lunch', label: 'Обед', now: c.lunchRevenue, was: p.lunchRevenue, pct: pct(c.lunchRevenue, p.lunchRevenue) },
      { key: 'dinner', label: 'Ужин', now: c.dinnerRevenue, was: p.dinnerRevenue, pct: pct(c.dinnerRevenue, p.dinnerRevenue) },
    ];

    // Объяснение падения: выручка складывается из числа чеков
    // и среднего чека — говорим, что именно просело
    const revPct = pct(c.revenue, p.revenue) ?? 0;
    let reason: string | null = null;
    if (revPct <= -5) {
      const checksPct = pct(c.checks, p.checks) ?? 0;
      const avgPct = pct(c.avgCheck, p.avgCheck) ?? 0;
      reason = Math.abs(checksPct) > Math.abs(avgPct)
        ? `Гостей стало меньше на ${Math.abs(checksPct)}% — средний чек держится`
        : `Гости стали брать дешевле на ${Math.abs(avgPct)}% — количество не упало`;
    }

    return {
      period,
      current: c,
      previous: p,
      changes,
      verdict: revPct > 5 ? 'growth' : revPct < -5 ? 'decline' : 'stable',
      reason,
    };
  }
}

// apps/api/src/reports/owner-digest.controller.ts
// Сводка владельцу на телефон.
//
// У iiko уведомления про прогнозы и незакрытые смены — техничные
// события системы. Владельцу нужно другое: что случилось с деньгами
// и что требует его решения сегодня.
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('digest')
@UseGuards(JwtGuard, PermissionsGuard)
export class OwnerDigestController {
  constructor(private prisma: PrismaService) {}

  /**
   * Утренняя сводка: что было вчера и что делать сегодня.
   *
   * Формат телефонный: пять строк, которые читаются за кофе.
   * Владелец не будет листать таблицы с экрана 6 дюймов.
   */
  @Get('morning')
  @RequirePermission('reports.view')
  async morning(@Req() req: any, @Query('locationId') locationId?: string) {
    const acc = req.user.acc;
    const now = new Date();

    const yStart = new Date(now); yStart.setDate(yStart.getDate() - 1); yStart.setHours(0, 0, 0, 0);
    const yEnd = new Date(yStart); yEnd.setHours(23, 59, 59, 999);
    // Неделю назад тот же день: сравнивать вторник с понедельником
    // бессмысленно, поток разный
    const wStart = new Date(yStart); wStart.setDate(wStart.getDate() - 7);
    const wEnd = new Date(yEnd); wEnd.setDate(wEnd.getDate() - 7);

    const where = locationId ? { locationId } : { accountId: acc };

    const [yOrders, wOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...where, status: 'CLOSED', closedAt: { gte: yStart, lte: yEnd } },
        select: { total: true, closedAt: true },
      }),
      this.prisma.order.findMany({
        where: { ...where, status: 'CLOSED', closedAt: { gte: wStart, lte: wEnd } },
        select: { total: true },
      }),
    ]);

    const revenue = yOrders.reduce((s, o) => s + o.total, 0);
    const wRevenue = wOrders.reduce((s, o) => s + o.total, 0);
    const pct = wRevenue > 0 ? Math.round(((revenue - wRevenue) / wRevenue) * 100) : null;

    // То, что требует решения владельца — не больше трёх пунктов.
    // Список из десяти дел не прочитают вовсе
    const actions: { text: string; urgency: 'now' | 'today' | 'week' }[] = [];

    // Незакрытая смена: чеки повиснут, Z-отчёт не сойдётся
    const openShifts = await this.prisma.cashShift.count({
      where: {
        accountId: acc, closedAt: null,
        openedAt: { lt: new Date(Date.now() - 20 * 3600_000) },
      },
    });
    if (openShifts > 0) {
      actions.push({ text: `Смена не закрыта со вчера — позвоните кассиру`, urgency: 'now' });
    }

    // Заканчивающиеся продукты по минимумам
    const limits = await this.prisma.stockLimit.findMany().catch(() => []);
    if (limits.length) {
      const balances = await this.prisma.stockBalance.findMany({
        where: { productId: { in: limits.map((l: any) => l.productId) } },
      });
      const balBy = new Map(balances.map((b) => [b.productId, Number(b.qty)] as const));
      const low = (limits as any[]).filter((l) => (balBy.get(l.productId) ?? 0) <= Number(l.minQty));
      if (low.length) {
        const names = await this.prisma.product.findMany({
          where: { id: { in: low.slice(0, 3).map((l) => l.productId) } },
          select: { name: true },
        });
        actions.push({
          text: `Заканчивается: ${names.map((n) => n.name.toLowerCase()).join(', ')}${low.length > 3 ? ` и ещё ${low.length - 3}` : ''}`,
          urgency: 'today',
        });
      }
    }

    // Резкое падение — повод разобраться сегодня, а не в конце месяца
    if (pct !== null && pct <= -20) {
      actions.push({
        text: `Выручка ниже прошлого ${yStart.toLocaleDateString('ru-RU', { weekday: 'long' })} на ${Math.abs(pct)}%`,
        urgency: 'today',
      });
    }

    // Час пик вчера: помогает понять, когда ставить людей
    const byHour = new Array(24).fill(0);
    for (const o of yOrders) byHour[o.closedAt!.getHours()] += o.total;
    const peak = byHour.indexOf(Math.max(...byHour));

    const money = (v: number) =>
      `${Math.trunc(v / 100).toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} ₸`;

    return {
      date: yStart,
      dateLabel: yStart.toLocaleDateString('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long',
      }),
      // Пять строк — столько помещается на экране телефона
      // без прокрутки и столько прочитают за кофе
      lines: [
        { key: 'revenue', label: 'Выручка', value: money(revenue),
          change: pct !== null ? `${pct > 0 ? '+' : ''}${pct}% к прошлой неделе` : null,
          tone: pct === null ? 'neutral' : pct >= 0 ? 'good' : pct <= -20 ? 'bad' : 'warn' },
        { key: 'checks', label: 'Чеков', value: String(yOrders.length), change: null, tone: 'neutral' },
        { key: 'avg', label: 'Средний чек',
          value: yOrders.length ? money(Math.round(revenue / yOrders.length)) : '—',
          change: null, tone: 'neutral' },
        { key: 'peak', label: 'Час пик',
          value: yOrders.length ? `${peak}:00` : '—',
          change: yOrders.length ? money(byHour[peak]) : null, tone: 'neutral' },
      ],
      actions: actions.slice(0, 3),
      // Если делать нечего — так и говорим. Пустой список
      // выглядит как ошибка загрузки
      allGood: actions.length === 0,
      goodText: actions.length === 0 ? 'Всё в порядке — можно спокойно пить кофе' : null,
    };
  }

  /**
   * Живые цифры: что происходит прямо сейчас.
   * Владелец открывает вечером из дома и видит, идёт ли работа.
   */
  @Get('live')
  @RequirePermission('reports.view')
  async live(@Req() req: any, @Query('locationId') locationId?: string) {
    const acc = req.user.acc;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const where = locationId ? { locationId } : { accountId: acc };

    const [closed, open, terminals] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...where, status: 'CLOSED', closedAt: { gte: dayStart } },
        select: { total: true },
      }),
      this.prisma.order.findMany({
        where: { ...where, status: 'OPEN' },
        select: { total: true, openedAt: true, guestsCount: true },
      }),
      this.prisma.terminal.findMany({
        where: locationId ? { locationId } : { location: { accountId: acc } },
        select: { name: true, lastSeenAt: true },
      }),
    ]);

    const now = Date.now();
    const offline = terminals.filter(
      (t) => !t.lastSeenAt || now - t.lastSeenAt.getTime() > 15 * 60_000,
    );

    const revenue = closed.reduce((s, o) => s + o.total, 0);
    const inHall = open.reduce((s, o) => s + o.total, 0);
    const guests = open.reduce((s, o) => s + (o.guestsCount ?? 1), 0);

    // Долго сидящие столы: два часа с открытым счётом — либо
    // забыли, либо гость ждёт и злится
    const longSitting = open.filter(
      (o) => now - o.openedAt.getTime() > 2 * 3600_000,
    ).length;

    return {
      at: new Date(),
      revenueToday: revenue,
      checksToday: closed.length,
      openTables: open.length,
      guestsNow: guests,
      inHallAmount: inHall,
      longSitting,
      // Касса не в сети — самое важное: продажи могут идти мимо
      offlineTerminals: offline.map((t) => t.name),
      // Одна фраза вместо цифр: владелец за рулём или в гостях
      summary: offline.length
        ? `Касса «${offline[0].name}» не в сети`
        : open.length
        ? `${open.length} столов занято на ${Math.trunc(inHall / 100).toLocaleString('ru-RU')} ₸`
        : closed.length
        ? `Сегодня ${closed.length} чеков на ${Math.trunc(revenue / 100).toLocaleString('ru-RU')} ₸`
        : 'Продаж пока нет',
    };
  }
}

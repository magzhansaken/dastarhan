// apps/api/src/staff/audit.controller.ts
// Журнал действий: кто что сделал и когда.
//
// Нужен для двух вещей: разобрать спорную ситуацию и заметить
// схему до того, как она станет привычкой. Поэтому показываем
// не сырые события, а то, что стоит внимания.
import {
  Controller, Get, Query, Req, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

/** События, которые стоит держать на виду. */
const WATCHED: Record<string, { label: string; risk: 'high' | 'medium' | 'low' }> = {
  'order.item.remove':      { label: 'Удаление позиции',        risk: 'high' },
  'order.cancel':           { label: 'Отмена заказа',           risk: 'high' },
  'order.refund':           { label: 'Возврат',                 risk: 'high' },
  'order.discount.manual':  { label: 'Ручная скидка',           risk: 'high' },
  'order.reopen':           { label: 'Переоткрытие чека',       risk: 'high' },
  'cash.out':               { label: 'Изъятие из кассы',        risk: 'high' },
  'order.item.moved':       { label: 'Перенос позиции',         risk: 'medium' },
  'order.waiter.changed':   { label: 'Смена официанта',         risk: 'medium' },
  'order.split':            { label: 'Разделение счёта',        risk: 'low' },
  'cash.shift.close':       { label: 'Закрытие смены',          risk: 'low' },
  'cash.in':                { label: 'Внесение в кассу',        risk: 'low' },
};

@Controller('audit')
@UseGuards(JwtGuard, PermissionsGuard)
export class AuditController {
  constructor(private prisma: PrismaService) {}

  /**
   * Журнал с фильтрами. Менеджер видит только свои точки —
   * это ограничение из практики: чужая выручка не его дело,
   * а любопытство рождает разговоры.
   */
  @Get()
  @RequirePermission('admin.employees')
  async list(
    @Req() req: any,
    @Query('days') days = '7',
    @Query('userId') userId?: string,
    @Query('type') type?: string,
    @Query('risk') risk?: string,
  ) {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    // Точки, за которые отвечает этот человек. Владелец видит все
    const assignments = await this.prisma.employeeAssignment.findMany({
      where: { userId: req.user.sub },
      select: { locationId: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { isOwner: true },
    });
    const myLocations = assignments.map((a) => a.locationId);

    const events = await this.prisma.eventLog.findMany({
      where: {
        accountId: req.user.acc,
        createdAt: { gte: from },
        ...(type ? { type } : { type: { in: Object.keys(WATCHED) } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const userIds = [...new Set(
      events.map((e) => (e.payload as any)?.byUserId).filter(Boolean),
    )];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName]));

    let rows = events.map((e) => {
      const p = e.payload as any;
      const meta = WATCHED[e.type] ?? { label: e.type, risk: 'low' as const };
      return {
        id: e.id,
        at: e.createdAt,
        type: e.type,
        label: meta.label,
        risk: meta.risk,
        userId: p?.byUserId ?? null,
        userName: nameBy.get(p?.byUserId) ?? null,
        orderNumber: p?.orderNumber ?? p?.number ?? null,
        amount: p?.amount ?? null,
        // Описание одной строкой: журнал читают глазами,
        // а не разбирают JSON
        summary: this.summarize(e.type, p),
      };
    });

    if (userId) rows = rows.filter((r) => r.userId === userId);
    if (risk) rows = rows.filter((r) => r.risk === risk);

    return {
      periodDays: Number(days),
      scope: user?.isOwner ? 'all' : 'own_locations',
      locationsCount: user?.isOwner ? null : myLocations.length,
      total: rows.length,
      highRisk: rows.filter((r) => r.risk === 'high').length,
      rows: rows.slice(0, 200),
    };
  }

  /**
   * Сводка по людям: у кого сколько рискованных действий.
   *
   * Показываем не абсолютное число, а долю от смен. Кассир,
   * работающий вдвое больше, естественно делает больше удалений —
   * и без нормировки выглядит вором.
   */
  @Get('by-person')
  @RequirePermission('admin.employees')
  async byPerson(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const events = await this.prisma.eventLog.findMany({
      where: {
        accountId: req.user.acc,
        createdAt: { gte: from },
        type: { in: Object.keys(WATCHED).filter((k) => WATCHED[k].risk === 'high') },
      },
      select: { type: true, payload: true, createdAt: true },
    });

    const byUser = new Map<string, { types: Map<string, number>; total: number }>();
    for (const e of events) {
      const uid = (e.payload as any)?.byUserId;
      if (!uid) continue;
      const cur = byUser.get(uid) ?? { types: new Map(), total: 0 };
      cur.types.set(e.type, (cur.types.get(e.type) ?? 0) + 1);
      cur.total++;
      byUser.set(uid, cur);
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byUser.keys()] } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName]));

    const rows = [];
    for (const [uid, v] of byUser) {
      const shifts = await this.prisma.cashShift.count({
        where: { openedBy: uid, openedAt: { gte: from } },
      });
      const orders = await this.prisma.order.count({
        where: { waiterId: uid, status: 'CLOSED', closedAt: { gte: from } },
      });

      rows.push({
        userId: uid,
        name: nameBy.get(uid) ?? '—',
        total: v.total,
        shifts,
        orders,
        // На сто чеков — сравнимая величина между людьми
        per100Orders: orders > 0 ? +((v.total / orders) * 100).toFixed(1) : null,
        breakdown: [...v.types.entries()].map(([type, count]) => ({
          type, label: WATCHED[type]?.label ?? type, count,
        })).sort((a, b) => b.count - a.count),
      });
    }

    rows.sort((a, b) => (b.per100Orders ?? 0) - (a.per100Orders ?? 0));

    // Аномалия — отклонение от своих же коллег, а не от нормы
    // из учебника. В разных заведениях разная культура работы
    const withRate = rows.filter((r) => r.per100Orders !== null);
    const avg = withRate.length
      ? withRate.reduce((s, r) => s + r.per100Orders!, 0) / withRate.length : 0;

    return {
      periodDays: Number(days),
      avgPer100: +avg.toFixed(1),
      rows: rows.map((r) => ({
        ...r,
        // Втрое чаще коллег — повод посмотреть, а не обвинять
        outlier: r.per100Orders !== null && avg > 0 && r.per100Orders > avg * 3,
      })),
      note: rows.some((r) => r.per100Orders !== null && avg > 0 && r.per100Orders > avg * 3)
        ? 'Кто-то делает рискованные операции втрое чаще коллег — посмотрите записи смен'
        : null,
    };
  }

  private summarize(type: string, p: any): string {
    if (!p) return '';
    switch (type) {
      case 'order.item.remove':
        return `${p.name ?? 'позиция'} из заказа №${p.orderNumber ?? '—'}`;
      case 'order.refund':
        return `${Math.trunc((p.amount ?? 0) / 100)} ₸ по заказу №${p.orderNumber ?? '—'}`;
      case 'order.discount.manual':
        return `${p.percent ? p.percent + '%' : Math.trunc((p.amount ?? 0) / 100) + ' ₸'}`;
      case 'order.item.moved':
        return `${p.name ?? 'позиция'} → заказ №${p.toOrder ?? '—'}`;
      case 'cash.out':
        return `${Math.trunc((p.amount ?? 0) / 100)} ₸ · ${p.reason ?? 'без причины'}`;
      case 'order.split':
        return `на ${p.parts ?? '?'} счёта`;
      default:
        return p.orderNumber ? `заказ №${p.orderNumber}` : '';
    }
  }
}

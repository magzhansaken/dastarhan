// apps/api/src/cash/shift.controller.ts
// Смены: открытие с разменом и закрытие с пересчётом наличных.
//
// Ключевое решение: расхождение НЕ блокирует закрытие смены.
// Кассир не может уйти домой, пока система не отпустит — поэтому
// смена закрывается всегда, а расхождение фиксируется и попадает
// в отчёт владельцу. Скрыть недостачу нельзя, но и держать человека
// заложником системы тоже неправильно.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class OpenShiftDto {
  @IsString() terminalId!: string;

  // Размен: с него кассир даёт сдачу. В закрытии вычтется автоматически
  @IsInt({ message: 'Размен должен быть целым числом тиын' })
  @Min(0, { message: 'Размен не может быть отрицательным' })
  openingCash!: number;


  /** Текущая смена терминала — касса спрашивает при запуске. */
  @Get('current')
  @RequirePermission('cash.shift.open')
  async current(@Query('terminalId') terminalId: string) {
    const shift = await this.prisma.cashShift.findFirst({
      where: { terminalId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) return { open: false };

    const orders = await this.prisma.order.count({ where: { shiftId: shift.id } });
    return {
      open: true,
      id: shift.id,
      number: shift.number,
      openedAt: shift.openedAt,
      openingCash: shift.openingCash,
      ordersCount: orders,
    };
  }

  /** Открыть смену с разменом. */
  @Post('open')
  @RequirePermission('cash.shift.open')
  async open(@Body() dto: OpenShiftDto, @Req() req: any) {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: dto.terminalId },
      include: { location: true },
    });
    if (!terminal) throw new NotFoundException({ code: 'TERMINAL_NOT_FOUND' });

    const open = await this.prisma.cashShift.findFirst({
      where: { terminalId: terminal.id, closedAt: null },
    });
    if (open) {
      // Не ошибка: касса могла перезапуститься. Отдаём текущую смену
      return { id: open.id, number: open.number, alreadyOpen: true };
    }

    const last = await this.prisma.cashShift.findFirst({
      where: { terminalId: terminal.id },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const shift = await this.prisma.cashShift.create({
      data: {
        accountId: terminal.location.accountId,
        locationId: terminal.locationId,
        terminalId: terminal.id,
        number: (last?.number ?? 0) + 1,
        openedBy: req.user.sub,
        openingCash: dto.openingCash,
      },
    });

    return { id: shift.id, number: shift.number, openingCash: shift.openingCash };
  }

  /**
   * Что должно быть в ящике. Считается перед закрытием, чтобы кассир
   * видел цифру ДО пересчёта — иначе он подгонит факт под ожидание.
   */
  @Get('expected')
  @RequirePermission('cash.shift.close')
  async expected(@Query('shiftId') shiftId: string) {
    const shift = await this.prisma.cashShift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND' });

    const orders = await this.prisma.order.findMany({
      where: { shiftId, status: 'CLOSED' },
      select: { id: true },
    });

    const payments = await this.prisma.payment.findMany({
      where: { orderId: { in: orders.map((o) => o.id) }, status: 'CAPTURED' },
      select: { kind: true, amount: true },
    });

    const cashRevenue = payments
      .filter((p) => p.kind === 'CASH')
      .reduce((s, p) => s + p.amount, 0);

    const transactions = await this.prisma.cashTransaction.findMany({
      where: { shiftId },
      select: { amount: true },
    }).catch(() => [] as any[]);

    // Внесения положительны, изъятия и инкассация отрицательны
    const movements = (transactions as any[]).reduce((s, t) => s + t.amount, 0);
    const expected = shift.openingCash + cashRevenue + movements;

    return {
      shiftId,
      openingCash: shift.openingCash,
      cashRevenue,
      movements,
      expected,
      ordersCount: orders.length,
      cardRevenue: payments.filter((p) => p.kind !== 'CASH').reduce((s, p) => s + p.amount, 0),
    };
  }

  /**
   * Закрыть смену. Расхождение фиксируется, но закрытие не блокирует:
   * кассир не должен оставаться заложником системы в конце рабочего дня.
   */
  @Post('close')
  @RequirePermission('cash.shift.close')
  async close(@Body() dto: CloseShiftDto, @Req() req: any) {
    const shift = await this.prisma.cashShift.findUnique({ where: { id: dto.shiftId } });
    if (!shift) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND' });
    if (shift.closedAt) throw new BadRequestException({ code: 'ALREADY_CLOSED' });

    const e = await this.expected(dto.shiftId);
    const discrepancy = dto.actualCash - e.expected;

    const closed = await this.prisma.cashShift.update({
      where: { id: shift.id },
      data: {
        closedBy: req.user.sub,
        closedAt: new Date(),
        expectedCash: e.expected,
        actualCash: dto.actualCash,
        discrepancy,
        note: dto.note ?? null,
      },
    });

    return {
      id: closed.id,
      number: closed.number,
      // Z-отчёт: то, что кассир видит на экране и отдаёт владельцу
      report: {
        openedAt: shift.openedAt,
        closedAt: closed.closedAt,
        ordersCount: e.ordersCount,
        openingCash: e.openingCash,
        cashRevenue: e.cashRevenue,
        cardRevenue: e.cardRevenue,
        expected: e.expected,
        actual: dto.actualCash,
        discrepancy,
        verdict: discrepancy === 0 ? 'Всё сошлось'
          : discrepancy > 0 ? 'Излишек' : 'Недостача',
      },
    };
  }

  /**
   * Z-отчёт: полная картина смены.
   *
   * У конкурентов это список сумм. Владелец смотрит на него утром
   * и не понимает, была смена хорошей или нет. Мы добавляем
   * сравнение с обычным днём и объясняем расхождения.
   */
  @Get(':id/z-report')
  @RequirePermission('cash.xreport')
  async zReport(@Param('id') id: string, @Req() req: any) {
    const shift = await this.prisma.cashShift.findUnique({ where: { id } });
    if (!shift) throw new NotFoundException({ code: 'SHIFT_NOT_FOUND' });

    const orders = await this.prisma.order.findMany({
      where: { shiftId: id, status: 'CLOSED' },
      include: { items: true, payments: true },
    });

    const revenue = orders.reduce((s, o) => s + o.total, 0);
    const discount = orders.reduce((s, o) => s + o.discount, 0);

    // Разбивка по способам оплаты: наличные должны сойтись
    // с пересчётом, безнал — с терминалом
    const byMethod = new Map<string, number>();
    for (const o of orders) {
      for (const p of o.payments) {
        if (p.status !== 'CAPTURED') continue;
        byMethod.set(p.kind, (byMethod.get(p.kind) ?? 0) + p.amount);
      }
    }

    const cash = byMethod.get('CASH') ?? 0;
    const cashIn = await this.prisma.cashMovement.aggregate({
      where: { shiftId: id, kind: 'IN' },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: 0 } }));
    const cashOut = await this.prisma.cashMovement.aggregate({
      where: { shiftId: id, kind: 'OUT' },
      _sum: { amount: true },
    }).catch(() => ({ _sum: { amount: 0 } }));

    const expected = shift.openingCash + cash
      + (cashIn._sum.amount ?? 0) - Math.abs(cashOut._sum.amount ?? 0);

    // Сравнение с обычной сменой того же дня недели: 380 000 ₸
    // это много или мало — зависит от того, вторник или суббота
    const dow = shift.openedAt.getDay();
    const past = await this.prisma.cashShift.findMany({
      where: {
        terminalId: shift.terminalId,
        closedAt: { not: null },
        id: { not: id },
        openedAt: { gte: new Date(Date.now() - 56 * 86400_000) },
      },
      select: { id: true, openedAt: true },
      take: 40,
    });
    const sameDowIds = past.filter((s) => s.openedAt.getDay() === dow).map((s) => s.id);

    let typical: number | null = null;
    if (sameDowIds.length >= 2) {
      const pastOrders = await this.prisma.order.groupBy({
        by: ['shiftId'],
        where: { shiftId: { in: sameDowIds }, status: 'CLOSED' },
        _sum: { total: true },
      });
      const sums = pastOrders.map((g) => g._sum.total ?? 0).sort((a, b) => a - b);
      // Медиана устойчивее среднего: одна банкетная смена
      // не должна задирать норму
      typical = sums.length % 2
        ? sums[(sums.length - 1) / 2]
        : Math.round((sums[sums.length / 2 - 1] + sums[sums.length / 2]) / 2);
    }

    // Рискованные операции за смену — то, что стоит проверить
    const events = await this.prisma.eventLog.findMany({
      where: {
        accountId: shift.accountId,
        createdAt: { gte: shift.openedAt, lte: shift.closedAt ?? new Date() },
        type: { in: ['order.item.remove', 'order.cancel', 'order.discount.manual', 'cash.out'] },
      },
      select: { type: true },
    });
    const risky = new Map<string, number>();
    for (const e of events) risky.set(e.type, (risky.get(e.type) ?? 0) + 1);

    const hours = shift.closedAt
      ? (shift.closedAt.getTime() - shift.openedAt.getTime()) / 3600_000
      : (Date.now() - shift.openedAt.getTime()) / 3600_000;

    const diffPct = typical && typical > 0
      ? Math.round(((revenue - typical) / typical) * 100) : null;

    return {
      shiftId: id,
      number: shift.number,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      hours: +hours.toFixed(1),
      openingCash: shift.openingCash,

      revenue,
      checks: orders.length,
      avgCheck: orders.length ? Math.round(revenue / orders.length) : 0,
      discount,
      guests: orders.reduce((s, o) => s + (o.guestsCount ?? 1), 0),

      byMethod: [...byMethod.entries()].map(([kind, sum]) => ({
        kind,
        label: kind === 'CASH' ? 'Наличные'
          : kind === 'CARD' ? 'Карта'
          : kind === 'KASPI_QR' ? 'Kaspi QR' : kind,
        sum,
        // Доля наличных: если она резко упала, возможно,
        // кассир не проводит их через кассу
        pct: revenue > 0 ? Math.round((sum / revenue) * 100) : 0,
      })),

      cashIn: cashIn._sum.amount ?? 0,
      cashOut: Math.abs(cashOut._sum.amount ?? 0),
      expectedCash: expected,
      countedCash: shift.countedCash ?? null,
      diff: shift.countedCash !== null && shift.countedCash !== undefined
        ? shift.countedCash - expected : null,

      // Выручка в час: сравнимая величина между сменами
      // разной длины
      perHour: hours > 0 ? Math.round(revenue / hours) : 0,
      typicalRevenue: typical,
      vsTypicalPct: diffPct,

      riskyOps: [...risky.entries()].map(([type, count]) => ({
        type,
        label: type === 'order.item.remove' ? 'Удаления позиций'
          : type === 'order.cancel' ? 'Отмены заказов'
          : type === 'order.discount.manual' ? 'Ручные скидки'
          : 'Изъятия из кассы',
        count,
      })),

      // Вердикт словами: смену закрывают в полночь, и разбираться
      // в цифрах уже нет сил
      verdict: this.verdictFor(revenue, typical, diffPct, risky),
    };
  }

  private verdictFor(
    revenue: number,
    typical: number | null,
    diffPct: number | null,
    risky: Map<string, number>,
  ): string {
    const removals = risky.get('order.item.remove') ?? 0;
    if (removals >= 15) {
      return `Много удалений позиций (${removals}) — стоит посмотреть, что происходит`;
    }
    if (diffPct === null) return 'Смена закрыта';
    if (diffPct >= 20) return `Выручка выше обычной на ${diffPct}% — хорошая смена`;
    if (diffPct <= -25) return `Выручка ниже обычной на ${Math.abs(diffPct)}% — разберитесь, что было`;
    return 'Смена в пределах обычного';
  }

  /**
   * Сравнение смен: кто из кассиров работает лучше.
   * Нормируем на часы, иначе тот, кто работает больше,
   * автоматически выглядит успешнее.
   */
  @Get('compare')
  @RequirePermission('reports.view')
  async compareShifts(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const shifts = await this.prisma.cashShift.findMany({
      where: {
        accountId: req.user.acc,
        closedAt: { not: null },
        openedAt: { gte: from },
      },
      select: {
        id: true, openedBy: true, openedAt: true, closedAt: true,
        countedCash: true,
      },
    });
    if (!shifts.length) return { rows: [], note: 'Закрытых смен за период нет' };

    const sums = await this.prisma.order.groupBy({
      by: ['shiftId'],
      where: { shiftId: { in: shifts.map((s) => s.id) }, status: 'CLOSED' },
      _sum: { total: true },
      _count: true,
    });
    const sumBy = new Map(sums.map((g) => [g.shiftId, g]));

    const byUser = new Map<string, {
      shifts: number; hours: number; revenue: number; checks: number;
    }>();
    for (const s of shifts) {
      const g = sumBy.get(s.id);
      const hours = (s.closedAt!.getTime() - s.openedAt.getTime()) / 3600_000;
      const cur = byUser.get(s.openedBy) ?? { shifts: 0, hours: 0, revenue: 0, checks: 0 };
      cur.shifts++;
      cur.hours += hours;
      cur.revenue += g?._sum.total ?? 0;
      cur.checks += g?._count ?? 0;
      byUser.set(s.openedBy, cur);
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byUser.keys()] } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName]));

    const rows = [...byUser.entries()].map(([userId, v]) => ({
      userId,
      name: nameBy.get(userId) ?? '—',
      shifts: v.shifts,
      hours: Math.round(v.hours),
      revenue: v.revenue,
      checks: v.checks,
      perHour: v.hours > 0 ? Math.round(v.revenue / v.hours) : 0,
      avgCheck: v.checks > 0 ? Math.round(v.revenue / v.checks) : 0,
    })).sort((a, b) => b.perHour - a.perHour);

    return {
      periodDays: Number(days),
      rows,
      // Средний чек важнее выручки в час: он показывает умение
      // предлагать, а не просто везение со сменами
      best: rows.length ? { name: rows[0].name, perHour: rows[0].perHour } : null,
      note: rows.length >= 2 && rows[0].avgCheck > rows[rows.length - 1].avgCheck * 1.3
        ? `У ${rows[0].name} средний чек выше — пусть поделится, как предлагает`
        : null,
    };
  }
}


class CloseShiftDto {
  @IsString() shiftId!: string;

  @IsInt({ message: 'Сумма должна быть целым числом тиын' })
  @Min(0)
  actualCash!: number;

  @IsOptional() @IsString() note?: string;
}

@Controller('shifts')
@UseGuards(JwtGuard, PermissionsGuard)
export class ShiftController {
  constructor(private prisma: PrismaService) {}
}

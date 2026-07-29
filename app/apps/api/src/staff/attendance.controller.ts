// apps/api/src/staff/attendance.controller.ts
// Явки: кто пришёл, кто опоздал, кто не вышел.
//
// У iiko явки помечаются цветом: зелёные принятые, розовые
// проблемные. Идея верная, но разбирать их приходится вручную.
// Мы считаем засчитанное время сами и объясняем каждое отклонение.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

/** Допуск: пять минут опоздания не повод для разбирательства. */
const GRACE_MIN = 5;
/** Округление засчитанного времени — до получаса, как принято. */
const ROUND_MIN = 30;

@Controller('attendance')
@UseGuards(JwtGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private prisma: PrismaService) {}

  /**
   * Отметиться на приходе. Сотрудник вводит PIN на кассе
   * или в приложении — отдельный турникет не нужен.
   */
  @Post('check-in')
  @RequirePermission('order.create')
  async checkIn(@Body() dto: { locationId: string }, @Req() req: any) {
    const open = await this.prisma.attendance.findFirst({
      where: { userId: req.user.sub, status: 'OPEN' },
    });
    if (open) {
      return {
        alreadyOpen: true,
        since: open.checkIn,
        // Не ругаем за повторное нажатие: человек мог не заметить,
        // что уже отметился
        message: `Вы уже отметились в ${open.checkIn.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
      };
    }

    const now = new Date();
    // Плановая смена на сегодня: ищем ближайшую по времени
    const plan = await this.prisma.workShift.findFirst({
      where: {
        userId: req.user.sub,
        startsAt: {
          gte: new Date(now.getTime() - 4 * 3600_000),
          lte: new Date(now.getTime() + 4 * 3600_000),
        },
      },
      orderBy: { startsAt: 'asc' },
    });

    let issue: string | null = null;
    if (plan) {
      const lateMin = Math.floor((now.getTime() - plan.startsAt.getTime()) / 60_000);
      if (lateMin > GRACE_MIN) {
        issue = `Опоздание ${lateMin} мин`;
      }
    }

    const a = await this.prisma.attendance.create({
      data: {
        accountId: req.user.acc,
        userId: req.user.sub,
        locationId: dto.locationId,
        checkIn: now,
        planFrom: plan?.startsAt ?? null,
        planTo: plan?.endsAt ?? null,
        status: issue ? 'ISSUE' : 'OPEN',
        issue,
      },
    });

    return {
      attendanceId: a.id,
      at: now,
      plan: plan ? { from: plan.startsAt, to: plan.endsAt } : null,
      issue,
      // Опоздание фиксируем, но не блокируем работу: человек
      // уже пришёл, пусть работает. Разберутся потом
      message: issue
        ? `Отмечено. ${issue} — старший увидит`
        : plan
        ? 'Отмечено вовремя'
        : 'Отмечено. Смены в расписании нет',
    };
  }

  /** Отметиться на уходе. */
  @Post('check-out')
  @RequirePermission('order.create')
  async checkOut(@Req() req: any) {
    const open = await this.prisma.attendance.findFirst({
      where: { userId: req.user.sub, status: { in: ['OPEN', 'ISSUE'] } },
      orderBy: { checkIn: 'desc' },
    });
    if (!open) {
      throw new BadRequestException({
        code: 'NOT_CHECKED_IN',
        message: 'Вы не отмечались на приходе',
      });
    }

    const now = new Date();
    const factMin = Math.floor((now.getTime() - open.checkIn.getTime()) / 60_000);

    // Округление вниз до получаса: 3 часа 50 минут это 3.5 часа,
    // а не 4. Иначе за смену набегает лишний час
    const counted = Math.floor(factMin / ROUND_MIN) * ROUND_MIN;

    const issues: string[] = [];
    if (open.issue) issues.push(open.issue);

    if (open.planTo) {
      const earlyMin = Math.floor((open.planTo.getTime() - now.getTime()) / 60_000);
      if (earlyMin > GRACE_MIN) issues.push(`Ранний уход на ${earlyMin} мин`);
    }
    // Больше 14 часов — либо забыли отметиться, либо переработка
    // за гранью закона. И то и другое надо разобрать
    if (factMin > 14 * 60) {
      issues.push('Больше 14 часов — проверьте, не забыли ли отметиться');
    }

    await this.prisma.attendance.update({
      where: { id: open.id },
      data: {
        checkOut: now,
        countedMin: counted,
        status: issues.length ? 'ISSUE' : 'CLOSED',
        issue: issues.length ? issues.join('; ') : null,
      },
    });

    return {
      at: now,
      factMin,
      countedMin: counted,
      countedHours: +(counted / 60).toFixed(1),
      issues,
      message: issues.length
        ? `Смена закрыта. ${issues.join('; ')}`
        : `Смена закрыта. Засчитано ${(counted / 60).toFixed(1)} ч`,
    };
  }

  /**
   * Табель за период. Показываем не только часы, но и то,
   * что требует разбора — иначе проблемные явки копятся месяцами.
   */
  @Get('sheet')
  @RequirePermission('admin.employees')
  async sheet(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
  ) {
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to ? new Date(to) : now;

    const rows = await this.prisma.attendance.findMany({
      where: {
        accountId: req.user.acc,
        checkIn: { gte: fromDate, lte: toDate },
        ...(locationId ? { locationId } : {}),
      },
      orderBy: { checkIn: 'desc' },
    });

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName] as const));

    const byUser = new Map<string, {
      days: number; minutes: number; issues: number; late: number;
    }>();
    for (const r of rows) {
      const cur = byUser.get(r.userId) ?? { days: 0, minutes: 0, issues: 0, late: 0 };
      cur.days++;
      cur.minutes += r.countedMin ?? 0;
      if (r.status === 'ISSUE') cur.issues++;
      if (r.issue?.includes('Опоздание')) cur.late++;
      byUser.set(r.userId, cur);
    }

    const people = [...byUser.entries()].map(([userId, v]) => ({
      userId,
      name: nameBy.get(userId) ?? '—',
      days: v.days,
      hours: +(v.minutes / 60).toFixed(1),
      issues: v.issues,
      lateCount: v.late,
      // Доля опозданий: три из тридцати — человек, десять из
      // двенадцати — система. Разные разговоры
      latePct: v.days > 0 ? Math.round((v.late / v.days) * 100) : 0,
    })).sort((a, b) => b.hours - a.hours);

    const openNow = rows.filter((r) => r.status === 'OPEN').length;

    return {
      period: { from: fromDate, to: toDate },
      people,
      totalHours: +(people.reduce((s, p) => s + p.hours, 0)).toFixed(1),
      unresolvedIssues: rows.filter((r) => r.status === 'ISSUE').length,
      openNow,
      // Незакрытые явки: человек ушёл и не отметился, часы копятся
      warning: openNow > 0
        ? `${openNow} явок не закрыто — время считается до сих пор`
        : null,
    };
  }

  /** Кто сейчас на смене — для менеджера и для кухни. */
  @Get('who-is-here')
  @RequirePermission('order.create')
  async whoIsHere(@Query('locationId') locationId: string) {
    const rows = await this.prisma.attendance.findMany({
      where: { locationId, status: { in: ['OPEN', 'ISSUE'] }, checkOut: null },
      orderBy: { checkIn: 'asc' },
    });

    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName] as const));

    const now = Date.now();
    return {
      count: rows.length,
      people: rows.map((r) => ({
        userId: r.userId,
        name: nameBy.get(r.userId) ?? '—',
        since: r.checkIn,
        hoursHere: +((now - r.checkIn.getTime()) / 3600_000).toFixed(1),
        issue: r.issue,
      })),
    };
  }

  /** Разобрать проблемную явку: принять или оштрафовать. */
  @Patch(':id/approve')
  @RequirePermission('admin.employees')
  async approve(
    @Param('id') id: string,
    @Body() dto: { note?: string },
    @Req() req: any,
  ) {
    await this.prisma.attendance.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.sub,
        note: dto.note ?? null,
      },
    });
    return { ok: true };
  }
}

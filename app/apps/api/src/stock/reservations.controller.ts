// apps/api/src/stock/reservations.controller.ts
// Брони столов и шахматка. Неподтверждённые брони — главная причина
// пустых столов в час пик, поэтому подтверждение обязательно.
import {
  Body, Controller, Get, Post, Patch, Param, Query, Req, UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

class CreateReservationDto {
  @IsString() locationId!: string;
  @IsOptional() @IsString() tableId?: string;
  @IsString() guestName!: string;
  @IsString() phone!: string;
  @IsInt() @Min(1) guests!: number;
  @IsString() startAt!: string;
  @IsOptional() @IsInt() @Min(30) durationMin?: number;
  @IsOptional() @IsInt() @Min(0) prepaid?: number;
  @IsOptional() @IsString() comment?: string;
}

@Controller('reservations')
@UseGuards(JwtGuard)
export class ReservationsController {
  constructor(private prisma: PrismaService) {}

  /** Брони на день со сводкой для шапки. */
  @Get()
  async list(@Query('locationId') locationId: string, @Query('date') date?: string) {
    const day = date ? new Date(date) : new Date();
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(day); to.setHours(23, 59, 59, 999);

    const rows = await this.prisma.reservation.findMany({
      where: { locationId, startAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      orderBy: { startAt: 'asc' },
      include: { table: { select: { name: true } } },
    });

    const tables = await this.prisma.diningTable.count({
      where: { hall: { locationId }, isActive: true },
    });

    // Вечер считаем отдельно: там пик, и владельцу важно знать,
    // сколько столов уже занято на 19:00–22:00
    const evening = rows.filter((r) => r.startAt.getHours() >= 18);

    return {
      date: from,
      total: rows.length,
      eveningCount: evening.length,
      tablesBusy: new Set(rows.map((r) => r.tableId).filter(Boolean)).size,
      tablesTotal: tables,
      prepaidCount: rows.filter((r) => r.prepaid > 0).length,
      // Неподтверждённые — те, кому надо позвонить за 2 часа
      unconfirmed: rows.filter((r) => r.status === 'NEW').length,
      rows: rows.map((r) => ({
        id: r.id,
        guestName: r.guestName,
        phone: r.phone,
        guests: r.guests,
        startAt: r.startAt,
        durationMin: r.durationMin,
        tableName: r.table?.name ?? null,
        status: r.status,
        prepaid: r.prepaid,
        comment: r.comment,
        confirmed: r.status !== 'NEW',
      })),
    };
  }

  /**
   * Шахматка: столы × часы на три дня.
   * Администратор видит свободные окна сразу, не сверяя список.
   */
  @Get('grid')
  async grid(@Query('locationId') locationId: string, @Query('days') days = '3') {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + Number(days));

    const [tables, rows] = await Promise.all([
      this.prisma.diningTable.findMany({
        where: { hall: { locationId }, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, seats: true },
      }),
      this.prisma.reservation.findMany({
        where: { locationId, startAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } },
        select: { tableId: true, startAt: true, durationMin: true, guestName: true, status: true },
      }),
    ]);

    return {
      from, days: Number(days),
      // Часы работы: шахматка на 24 часа нечитаема, показываем 10:00–23:00
      hours: Array.from({ length: 14 }, (_, i) => 10 + i),
      tables,
      cells: rows.map((r) => ({
        tableId: r.tableId,
        hour: r.startAt.getHours(),
        date: r.startAt.toISOString().slice(0, 10),
        span: Math.ceil(r.durationMin / 60),
        guestName: r.guestName,
        confirmed: r.status !== 'NEW',
      })),
    };
  }

  @Post()
  async create(@Body() dto: CreateReservationDto, @Req() req: any) {
    const r = await this.prisma.reservation.create({
      data: {
        accountId: req.user.acc,
        locationId: dto.locationId,
        tableId: dto.tableId ?? null,
        guestName: dto.guestName.trim(),
        phone: dto.phone.trim(),
        guests: dto.guests,
        startAt: new Date(dto.startAt),
        durationMin: dto.durationMin ?? 120,
        prepaid: dto.prepaid ?? 0,
        comment: dto.comment ?? null,
      },
    });
    return { id: r.id, status: r.status };
  }

  /** Подтверждение брони: гость ответил на звонок или по ссылке. */
  @Patch(':id/confirm')
  async confirm(@Param('id') id: string) {
    const r = await this.prisma.reservation.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: 'RESERVATION_NOT_FOUND' });
    await this.prisma.reservation.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    return { ok: true, status: 'CONFIRMED' };
  }

  /**
   * Гость не пришёл. Считаем отдельно от отмены: по количеству
   * таких броней видно, работает ли напоминание за 2 часа.
   */
  @Patch(':id/no-show')
  async noShow(@Param('id') id: string) {
    await this.prisma.reservation.update({
      where: { id }, data: { status: 'NO_SHOW' },
    }).catch(() => null);
    return { ok: true, status: 'NO_SHOW' };
  }

  /** Гость сел за стол: администратор отмечает прямо в шахматке. */
  @Patch(':id/seat')
  async seat(@Param('id') id: string) {
    await this.prisma.reservation.update({
      where: { id }, data: { status: 'SEATED' },
    }).catch(() => null);
    return { ok: true, status: 'SEATED' };
  }

  /** Отмена брони: стол сразу освобождается в шахматке. */
  @Patch(':id/cancel')
  async cancel(@Param('id') id: string) {
    await this.prisma.reservation.update({
      where: { id }, data: { status: 'CANCELLED' },
    }).catch(() => null);
    return { ok: true, status: 'CANCELLED' };
  }
}

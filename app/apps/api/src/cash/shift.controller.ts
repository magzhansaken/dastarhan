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
}

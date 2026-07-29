// apps/api/src/menu/hall.controller.ts
// Карта зала: столы по зонам с состоянием. Официант видит,
// где кто сидит и на сколько, не обходя зал глазами.
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

class TableDto {
  @IsString() hallId!: string;
  @IsString() @Length(1, 12) name!: string;
  @IsInt() @Min(1) seats!: number;
  @IsInt() x!: number;
  @IsInt() y!: number;
  @IsIn(['square', 'round', 'rect']) shape!: string;
}

class MoveDto {
  @IsInt() x!: number;
  @IsInt() y!: number;
}

class HallDto {
  @IsString() locationId!: string;
  @IsString() @Length(1, 40) name!: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

@Controller('hall')
@UseGuards(JwtGuard)
export class HallController {
  constructor(private prisma: PrismaService) {}

  @Get('map')
  async map(@Query('locationId') locationId: string) {
    const halls = await this.prisma.hall.findMany({
      where: { locationId },
      orderBy: { sortOrder: 'asc' },
      include: { tables: { where: { isActive: true } } },
    });

    const tableIds = halls.flatMap((h) => h.tables.map((t) => t.id));
    const open = await this.prisma.order.findMany({
      where: { tableId: { in: tableIds }, status: 'OPEN' },
      select: { id: true, tableId: true, number: true, total: true, openedAt: true, guestsCount: true },
    });
    const byTable = new Map(open.map((o) => [o.tableId!, o] as const));
    const now = Date.now();

    return halls.map((h) => ({
      hallId: h.id,
      name: h.name,
      tables: h.tables.map((t) => {
        const o = byTable.get(t.id);
        // Время за столом важнее суммы: гость, сидящий два часа
        // с пустым чеком, — это либо забытый стол, либо проблема
        const minutes = o ? Math.floor((now - o.openedAt.getTime()) / 60000) : 0;
        return {
          tableId: t.id,
          name: t.name,
          seats: t.seats,
          x: t.x, y: t.y, shape: t.shape,
          busy: !!o,
          orderId: o?.id ?? null,
          orderNumber: o?.number ?? null,
          total: o?.total ?? 0,
          guests: o?.guestsCount ?? 0,
          minutes,
          isLong: minutes > 90,
        };
      }),
    }));
  }

  // ═══════════════ РЕДАКТОР ЗАЛА ═══════════════
  // Владелец расставляет столы один раз при запуске и правит
  // при перестановке мебели. Координаты в сетке 20 px:
  // столы выравниваются сами, план не выглядит кривым.

  /** Создать зал: основной, терраса, второй этаж, VIP. */
  @Post('halls')
  async createHall(@Body() dto: HallDto) {
    const last = await this.prisma.hall.findFirst({
      where: { locationId: dto.locationId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const hall = await this.prisma.hall.create({
      data: {
        locationId: dto.locationId,
        name: dto.name.trim(),
        sortOrder: dto.sortOrder ?? (last?.sortOrder ?? 0) + 1,
      },
    });
    return { id: hall.id, name: hall.name };
  }

  /** Добавить стол на план. */
  @Post('tables')
  async createTable(@Body() dto: TableDto) {
    const hall = await this.prisma.hall.findUnique({ where: { id: dto.hallId } });
    if (!hall) throw new NotFoundException({ code: 'HALL_NOT_FOUND' });

    // Номер стола уникален в пределах точки, а не зала: гость говорит
    // «я за четвёртым», и официант не должен уточнять, в каком зале
    const dup = await this.prisma.diningTable.findFirst({
      where: { hall: { locationId: hall.locationId }, name: dto.name.trim(), isActive: true },
    });
    if (dup) {
      throw new BadRequestException({
        code: 'TABLE_NAME_TAKEN',
        message: `Стол «${dto.name}» уже есть на этой точке`,
      });
    }

    const table = await this.prisma.diningTable.create({
      data: {
        hallId: dto.hallId,
        name: dto.name.trim(),
        seats: dto.seats,
        x: this.snap(dto.x),
        y: this.snap(dto.y),
        shape: dto.shape,
      },
    });
    return { id: table.id, name: table.name, x: table.x, y: table.y };
  }

  /** Передвинуть стол: перетаскивание мышкой на плане. */
  @Patch('tables/:id/move')
  async moveTable(@Param('id') id: string, @Body() dto: MoveDto) {
    const table = await this.prisma.diningTable.update({
      where: { id },
      data: { x: this.snap(dto.x), y: this.snap(dto.y) },
    });
    return { id: table.id, x: table.x, y: table.y };
  }

  /** Изменить стол: имя, места, форма. */
  @Patch('tables/:id')
  async updateTable(@Param('id') id: string, @Body() dto: Partial<TableDto>) {
    const table = await this.prisma.diningTable.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.seats ? { seats: dto.seats } : {}),
        ...(dto.shape ? { shape: dto.shape } : {}),
      },
    });
    return { id: table.id, name: table.name, seats: table.seats, shape: table.shape };
  }

  /**
   * Убрать стол с плана. Не удаляем: к нему привязаны заказы
   * прошлых смен, и отчёт «выручка по столам» должен работать.
   */
  @Delete('tables/:id')
  async removeTable(@Param('id') id: string) {
    const open = await this.prisma.order.count({
      where: { tableId: id, status: 'OPEN' },
    });
    if (open > 0) {
      throw new BadRequestException({
        code: 'TABLE_BUSY',
        message: 'За столом открытый заказ — сначала закройте его',
      });
    }
    await this.prisma.diningTable.update({
      where: { id }, data: { isActive: false },
    });
    return { ok: true };
  }

  /** Выручка по столам: какие места приносят деньги, а какие простаивают. */
  @Get('revenue')
  async revenue(@Query('locationId') locationId: string, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const tables = await this.prisma.diningTable.findMany({
      where: { hall: { locationId }, isActive: true },
      select: { id: true, name: true, seats: true },
    });

    const orders = await this.prisma.order.findMany({
      where: {
        tableId: { in: tables.map((t) => t.id) },
        status: 'CLOSED',
        closedAt: { gte: from },
      },
      select: { tableId: true, total: true },
    });

    const agg = new Map<string, { sum: number; checks: number }>();
    for (const o of orders) {
      const cur = agg.get(o.tableId!) ?? { sum: 0, checks: 0 };
      agg.set(o.tableId!, { sum: cur.sum + o.total, checks: cur.checks + 1 });
    }

    return tables.map((t) => {
      const a = agg.get(t.id) ?? { sum: 0, checks: 0 };
      return {
        tableId: t.id,
        name: t.name,
        seats: t.seats,
        revenue: a.sum,
        checks: a.checks,
        avgCheck: a.checks ? Math.round(a.sum / a.checks) : 0,
        // Выручка на место: стол на восемь мест должен приносить
        // больше двухместного, иначе он занимает площадь зря
        perSeat: t.seats > 0 ? Math.round(a.sum / t.seats) : 0,
      };
    }).sort((a, b) => b.revenue - a.revenue);
  }

  /** Привязка к сетке 20 px: план не выглядит кривым. */
  private snap(v: number): number {
    return Math.max(0, Math.round(v / 20) * 20);
  }
}

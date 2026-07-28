// apps/api/src/menu/hall.controller.ts
// Карта зала: столы по зонам с состоянием. Официант видит,
// где кто сидит и на сколько, не обходя зал глазами.
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

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
    const byTable = new Map(open.map((o) => [o.tableId!, o]));
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
}

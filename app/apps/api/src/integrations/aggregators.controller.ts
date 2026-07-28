// apps/api/src/integrations/aggregators.controller.ts
// Агрегаторы доставки Казахстана: Wolt, Glovo, Chocofood, Rahmet.
//
// Все работают одинаково: присылают заказ вебхуком, ждут подтверждения,
// потом статусы. Поэтому один контроллер на всех — различия только
// в разборе тела запроса.
import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

type Aggregator = 'wolt' | 'glovo' | 'chocofood' | 'rahmet';

const AGGREGATORS: Record<Aggregator, { name: string; commissionPct: number }> = {
  wolt: { name: 'Wolt', commissionPct: 25 },
  glovo: { name: 'Glovo', commissionPct: 27 },
  chocofood: { name: 'Chocofood', commissionPct: 20 },
  rahmet: { name: 'Rahmet', commissionPct: 15 },
};

@Controller('aggregators')
export class AggregatorsController {
  constructor(private prisma: PrismaService) {}

  /**
   * Приём заказа от агрегатора. Не создаём заказ сразу — пишем событие
   * и ждём подтверждения кассира. Иначе кухня начнёт готовить то,
   * чего нет в стопе, и заказ придётся отменять уже после принятия.
   */
  @Post(':provider/webhook')
  async webhook(@Param('provider') provider: string, @Body() body: any) {
    const key = provider.toLowerCase() as Aggregator;
    if (!AGGREGATORS[key]) throw new BadRequestException({ code: 'UNKNOWN_PROVIDER' });

    const venueId = body.venue_id ?? body.venueId ?? body.restaurant_id;
    const location = venueId
      ? await this.prisma.location.findFirst({ where: { id: String(venueId) } })
      : null;

    await this.prisma.eventLog.create({
      data: {
        eventId: `${key}-${body.id ?? randomUUID()}`,
        accountId: location?.accountId ?? '',
        terminalId: null,
        type: 'aggregator.order',
        payload: {
          provider: key,
          externalId: String(body.id ?? ''),
          items: body.items ?? [],
          total: body.total ?? body.price ?? 0,
          customerName: body.customer?.name ?? null,
          address: body.delivery?.address ?? null,
          comment: body.comment ?? null,
          // Комиссия агрегатора: владелец должен видеть чистыми,
          // сколько осталось после 25% Wolt
          commissionPct: AGGREGATORS[key].commissionPct,
        },
        createdAt: new Date(),
      },
    }).catch(() => null);

    return { ok: true, needsConfirm: true };
  }

  /** Настройки подключения агрегаторов. */
  @Get('status')
  @UseGuards(JwtGuard)
  async status(@Req() req: any) {
    const rows = Object.entries(AGGREGATORS).map(([key, v]) => {
      const envKey = `${key.toUpperCase()}_VENUE_ID`;
      return {
        provider: key,
        name: v.name,
        commissionPct: v.commissionPct,
        configured: !!process.env[envKey],
        // Честно про условия: у Wolt и Glovo нужен свой договор,
        // мы только передаём заказы
        needsOwnContract: key === 'wolt' || key === 'glovo',
        hint: process.env[envKey] ? null : `Впишите ${envKey} в .env — ID выдаёт менеджер ${v.name}`,
      };
    });

    return {
      note: 'Комиссия агрегатора вычитается из выручки — в отчёте видно чистыми',
      rows,
    };
  }

  /**
   * Выручка через агрегаторы с учётом комиссии.
   * Владелец видит, сколько реально осталось, а не оборот.
   */
  @Get('revenue')
  @UseGuards(JwtGuard)
  async revenue(@Req() req: any, @Query('days') days = '30') {
    const from = new Date();
    from.setDate(from.getDate() - Number(days));

    const events = await this.prisma.eventLog.findMany({
      where: {
        accountId: req.user.acc,
        type: 'aggregator.order',
        createdAt: { gte: from },
      },
      select: { payload: true },
    });

    const byProvider = new Map<string, { gross: number; count: number; commission: number }>();
    for (const e of events) {
      const p = e.payload as any;
      const key = p.provider ?? 'unknown';
      const total = Number(p.total ?? 0);
      const pct = Number(p.commissionPct ?? 0);
      const cur = byProvider.get(key) ?? { gross: 0, count: 0, commission: 0 };
      byProvider.set(key, {
        gross: cur.gross + total,
        count: cur.count + 1,
        commission: cur.commission + Math.round(total * pct / 100),
      });
    }

    const rows = [...byProvider.entries()].map(([provider, v]) => ({
      provider,
      name: AGGREGATORS[provider as Aggregator]?.name ?? provider,
      orders: v.count,
      gross: v.gross,
      commission: v.commission,
      net: v.gross - v.commission,
      // Средний чек через агрегатор обычно выше зального:
      // доставку заказывают компанией
      avgCheck: v.count ? Math.round(v.gross / v.count) : 0,
    }));

    return {
      rows: rows.sort((a, b) => b.net - a.net),
      totalGross: rows.reduce((s, r) => s + r.gross, 0),
      totalCommission: rows.reduce((s, r) => s + r.commission, 0),
      totalNet: rows.reduce((s, r) => s + r.net, 0),
    };
  }
}

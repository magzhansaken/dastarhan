// apps/api/src/delivery/delivery.controller.ts
// Доставка: зоны, рейсы курьеров, долг наличных.
// Геометрия зон и денежная логика рейса уже в delivery.logic и покрыты
// тестами — контроллер только выбирает данные и вызывает их.
import { Controller, Get, Query, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { resolveZone } from './delivery.logic';

@Controller('delivery')
@UseGuards(JwtGuard)
export class DeliveryController {
  constructor(private prisma: PrismaService) {}

  /**
   * Определить зону доставки по координатам.
   * Зоны проверяются по приоритету: вложенная зона «центр» должна
   * победить общую «город», иначе центр будет считаться по общему тарифу.
   */
  @Get('zone')
  async zone(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('locationId') locationId: string,
    @Query('orderTotal') orderTotal?: string,
  ) {
    const latN = Number(lat), lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
      throw new BadRequestException({ code: 'BAD_COORDS' });
    }
    const total = Number(orderTotal ?? 0) || 0;

    const zones = await this.prisma.deliveryZone.findMany({
      where: { locationId, isActive: true },
    });

    const res = resolveZone(
      [latN, lngN],
      total,
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        polygon: z.polygon as any,
        priority: z.priority,
        minOrder: z.minOrder,
        deliveryFee: z.deliveryFee,
        freeFrom: z.freeFrom,
        etaMinutes: z.etaMinutes,
      })) as any,
    );

    if ('error' in res) {
      // Причину отказа возвращаем разную: «вне зоны» — повод перезвонить,
      // «мало для минимального заказа» — повод предложить добрать до суммы
      if (res.error === 'MIN_ORDER') {
        return {
          inZone: true, canDeliver: false,
          reason: 'MIN_ORDER', minOrderNeeded: res.needed,
        };
      }
      return { inZone: false, canDeliver: false, reason: 'OUT_OF_ZONE' };
    }

    return {
      inZone: true,
      canDeliver: true,
      zoneId: res.zone.id,
      name: res.zone.name,
      fee: res.fee,
      minOrder: res.zone.minOrder,
      etaMinutes: res.zone.etaMinutes,
    };
  }

  /** Активный рейс курьера: заказы и долг наличных. */
  @Get('trip')
  async trip(@Query('courierId') courierId: string) {
    const trip = await this.prisma.courierTrip.findFirst({
      where: { courierId, closedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (!trip) return { active: false, orders: [], cashDebt: 0 };

    const infos = await this.prisma.deliveryInfo.findMany({
      where: { tripId: trip.id },
      include: { order: { select: { id: true, number: true, total: true, status: true } } },
    });

    // Долг = собрано наличными минус сданное. Курьер видит эту цифру
    // в шапке приложения постоянно — чтобы знать, сколько сдавать
    const cashDebt = trip.cashCollected - trip.cashReturned;

    return {
      active: true,
      tripId: trip.id,
      startedAt: trip.startedAt,
      cashCollected: trip.cashCollected,
      cashReturned: trip.cashReturned,
      cashDebt,
      orders: infos.map((i) => ({
        orderId: i.orderId,
        number: (i as any).order?.number ?? null,
        address: i.address,
        phone: i.phone,
        comment: i.comment,
        promisedAt: i.promisedAt,
        deliveryFee: i.deliveryFee,
        total: (i as any).order?.total ?? 0,
        status: (i as any).order?.status ?? null,
      })),
    };
  }
}

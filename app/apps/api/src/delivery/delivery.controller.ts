// apps/api/src/delivery/delivery.controller.ts
// Доставка: зоны, рейсы курьеров, долг наличных.
// Геометрия зон и денежная логика рейса уже в delivery.logic и покрыты
// тестами — контроллер только выбирает данные и вызывает их.
import {
  Controller, Get, Post, Body, Query, UseGuards, Req,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { resolveZone } from './delivery.logic';

class DeliveredDto {
  @IsString() orderId!: string;
  // Наличные, принятые у двери. Ноль для предоплаченных Kaspi
  @IsInt() @Min(0) cashTaken!: number;
}

class ReturnedDto {
  @IsString() orderId!: string;
  @IsString() reason!: string;
}

class HandoverDto {
  @IsString() tripId!: string;
  @IsInt() @Min(1, { message: 'Сумма должна быть больше нуля' }) amount!: number;
}

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

    // Тип Zone в логике не содержит name — оно только в БД
    const zoneRow = zones.find((z) => z.id === res.zone.id);
    return {
      inZone: true,
      canDeliver: true,
      zoneId: res.zone.id,
      name: zoneRow?.name ?? null,
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
    });

    // Связи DeliveryInfo → Order в схеме нет, только orderId:
    // читаем заказы одним запросом и сопоставляем по id
    const orders = await this.prisma.order.findMany({
      where: { id: { in: infos.map((i) => i.orderId) } },
      select: { id: true, number: true, total: true, status: true },
    });
    const orderById = new Map(orders.map((o) => [o.id, o]));

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
      // Долг виден курьеру постоянно — он должен знать,
      // сколько сдавать, не считая в уме между адресами
      orders: infos.map((i) => ({
        orderId: i.orderId,
        number: orderById.get(i.orderId)?.number ?? null,
        address: i.address,
        phone: i.phone,
        comment: i.comment,
        promisedAt: i.promisedAt,
        deliveryFee: i.deliveryFee,
        total: orderById.get(i.orderId)?.total ?? 0,
        status: orderById.get(i.orderId)?.status ?? null,
      })),
    };
  }

  /**
   * Заказ вручён. Наличные, принятые у двери, ложатся в долг курьера —
   * он сдаст их на кассе при закрытии рейса.
   */
  @Post('delivered')
  async delivered(@Body() dto: DeliveredDto) {
    const info = await this.prisma.deliveryInfo.findFirst({
      where: { orderId: dto.orderId },
    });
    if (!info) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND' });
    if (!info.tripId) throw new BadRequestException({ code: 'NOT_IN_TRIP' });

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: dto.orderId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });

      if (dto.cashTaken > 0) {
        const trip = await tx.courierTrip.findUnique({ where: { id: info.tripId! } });
        await tx.courierTrip.update({
          where: { id: info.tripId! },
          data: { cashCollected: (trip?.cashCollected ?? 0) + dto.cashTaken },
        });
      }
    });

    return { ok: true, orderId: dto.orderId, cashTaken: dto.cashTaken };
  }

  /**
   * Возврат: гость не открыл, отказался, адрес не найден.
   * Причина уходит менеджеру — по ней потом видно, что чинить:
   * адреса, курьеров или предоплату.
   */
  @Post('returned')
  async returned(@Body() dto: ReturnedDto) {
    const info = await this.prisma.deliveryInfo.findFirst({
      where: { orderId: dto.orderId },
    });
    if (!info) throw new NotFoundException({ code: 'DELIVERY_NOT_FOUND' });

    await this.prisma.order.update({
      where: { id: dto.orderId },
      data: { status: 'CANCELLED', comment: `Возврат: ${dto.reason}` },
    });

    return { ok: true, orderId: dto.orderId, reason: dto.reason };
  }

  /** Сдача наличных на кассе. Долг уменьшается на сданную сумму. */
  @Post('handover')
  async handover(@Body() dto: HandoverDto) {
    const trip = await this.prisma.courierTrip.findUnique({ where: { id: dto.tripId } });
    if (!trip) throw new NotFoundException({ code: 'TRIP_NOT_FOUND' });

    const debt = trip.cashCollected - trip.cashReturned;
    if (dto.amount > debt) {
      throw new BadRequestException({
        code: 'OVER_DEBT',
        message: `Курьер должен ${Math.trunc(debt / 100)} ₸, сдаёт больше`,
        debt,
      });
    }

    const updated = await this.prisma.courierTrip.update({
      where: { id: dto.tripId },
      data: { cashReturned: trip.cashReturned + dto.amount },
    });

    return {
      ok: true,
      cashCollected: updated.cashCollected,
      cashReturned: updated.cashReturned,
      debt: updated.cashCollected - updated.cashReturned,
    };
  }

  /**
   * Закрыть рейс. Нельзя при долге или заказах в пути —
   * это защита кассы: курьер не уходит домой с чужими деньгами.
   */
  @Post('close-trip')
  async closeTrip(@Body() dto: { tripId: string }) {
    const trip = await this.prisma.courierTrip.findUnique({ where: { id: dto.tripId } });
    if (!trip) throw new NotFoundException({ code: 'TRIP_NOT_FOUND' });

    const debt = trip.cashCollected - trip.cashReturned;
    if (debt !== 0) {
      throw new BadRequestException({
        code: 'DEBT_NOT_ZERO',
        message: `Сначала сдайте ${Math.trunc(debt / 100)} ₸ на кассе`,
        debt,
      });
    }

    const infos = await this.prisma.deliveryInfo.findMany({ where: { tripId: dto.tripId } });
    const inFlight = await this.prisma.order.count({
      where: { id: { in: infos.map((i) => i.orderId) }, status: 'OPEN' },
    });
    if (inFlight > 0) {
      throw new BadRequestException({
        code: 'ORDERS_IN_FLIGHT',
        message: `В пути ещё ${inFlight} заказ${inFlight === 1 ? '' : 'а'}`,
      });
    }

    await this.prisma.courierTrip.update({
      where: { id: dto.tripId },
      data: { closedAt: new Date() },
    });

    return { ok: true, closed: true, orders: infos.length };
  }
}

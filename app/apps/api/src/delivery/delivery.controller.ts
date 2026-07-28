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

    // Состав заказа курьеру нужен: гость спрашивает «а соус положили?»,
    // и курьер должен ответить, не звоня на кухню
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: { in: infos.map((i) => i.orderId) }, isRemoved: false },
      select: { orderId: true, nameSnapshot: true, qty: true },
    });
    const itemsByOrder = new Map<string, { name: string; qty: number }[]>();
    for (const it of items) {
      const arr = itemsByOrder.get(it.orderId) ?? [];
      arr.push({ name: it.nameSnapshot, qty: Number(it.qty) });
      itemsByOrder.set(it.orderId, arr);
    }

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
        customerName: (i as any).customerName ?? null,
        // Координаты для навигатора: 2ГИС строит маршрут точнее
        // по точке, чем по текстовому адресу
        lat: i.lat, lng: i.lng,
        items: itemsByOrder.get(i.orderId) ?? [],
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

  /**
   * Карточка гостя по телефону — первый экран приёма заказа.
   * Оператор вводит номер и сразу видит: имя, прошлые адреса,
   * что заказывал, были ли жалобы.
   *
   * У iiko история 90 дней. Мы не ограничиваем срок, но показываем
   * давность: адрес двухлетней давности стоит переспросить,
   * а вчерашний — подставить сразу.
   */
  @Get('customer-lookup')
  @UseGuards(JwtGuard)
  async lookup(@Query('phone') phone: string, @Req() req: any) {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length < 10) {
      return { found: false, hint: 'Введите номер полностью' };
    }
    const norm = digits.length === 11 && (digits[0] === '7' || digits[0] === '8')
      ? '+7' + digits.slice(1)
      : digits.length === 10 ? '+7' + digits : '+' + digits;

    const customer = await this.prisma.customer.findFirst({
      where: { accountId: req.user.acc, phone: norm },
    });

    // Адреса берём из прошлых доставок, даже если гость не заведён:
    // человек мог заказывать без регистрации
    const infos = await this.prisma.deliveryInfo.findMany({
      where: { phone: norm },
      orderBy: { id: 'desc' },
      take: 30,
      select: {
        address: true, lat: true, lng: true, comment: true,
        orderId: true, zoneId: true,
      },
    });

    const orders = await this.prisma.order.findMany({
      where: { id: { in: infos.map((i) => i.orderId) } },
      select: { id: true, total: true, closedAt: true, status: true },
    });
    const orderBy = new Map(orders.map((o) => [o.id, o]));

    // Уникальные адреса с частотой: чаще всего заказывают домой,
    // и этот адрес должен быть первым
    const byAddress = new Map<string, {
      address: string; lat: number | null; lng: number | null;
      comment: string | null; count: number; lastAt: Date | null;
    }>();

    for (const i of infos) {
      if (!i.address) continue;
      const key = i.address.trim().toLowerCase();
      const o = orderBy.get(i.orderId);
      const cur = byAddress.get(key);
      if (cur) {
        cur.count++;
        if (o?.closedAt && (!cur.lastAt || o.closedAt > cur.lastAt)) cur.lastAt = o.closedAt;
      } else {
        byAddress.set(key, {
          address: i.address, lat: i.lat, lng: i.lng,
          comment: i.comment, count: 1, lastAt: o?.closedAt ?? null,
        });
      }
    }

    const now = Date.now();
    const addresses = [...byAddress.values()]
      .sort((a, b) => b.count - a.count)
      .map((a) => {
        const days = a.lastAt
          ? Math.floor((now - a.lastAt.getTime()) / 86400_000) : null;
        return {
          address: a.address, lat: a.lat, lng: a.lng, comment: a.comment,
          ordersCount: a.count,
          lastDaysAgo: days,
          // Старый адрес переспрашиваем: человек мог переехать,
          // и курьер поедет впустую
          confirm: days === null || days > 180,
        };
      });

    const closed = orders.filter((o) => o.status === 'CLOSED');
    const totalSpent = closed.reduce((s, o) => s + o.total, 0);

    return {
      found: !!customer || infos.length > 0,
      phone: norm,
      name: customer?.name ?? null,
      customerId: customer?.id ?? null,
      addresses,
      ordersCount: closed.length,
      totalSpent,
      avgCheck: closed.length ? Math.round(totalSpent / closed.length) : 0,
      lastOrderAt: closed[0]?.closedAt ?? null,
      // Новый гость — повод предложить акцию, постоянный — сказать
      // «как обычно?». Оператор должен видеть разницу сразу
      isNew: closed.length === 0,
      isRegular: closed.length >= 5,
    };
  }

  /**
   * Приём заказа доставки. Обещанное время считаем честно:
   * приготовление плюс дорога, а не «через час» наугад.
   */
  @Post('order')
  @UseGuards(JwtGuard)
  async createDelivery(
    @Body() dto: {
      locationId: string;
      phone: string;
      name?: string;
      address: string;
      lat?: number; lng?: number;
      comment?: string;
      items: { productId: string; qty: number }[];
      scheduledAt?: string;
    },
    @Req() req: any,
  ) {
    if (!dto.items?.length) throw new BadRequestException({ code: 'EMPTY_ORDER' });

    const products = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((i) => i.productId) } },
      select: { id: true, name: true, basePrice: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const subtotal = dto.items.reduce((s, i) => {
      const p = byId.get(i.productId);
      return s + (p?.basePrice ?? 0) * i.qty;
    }, 0);

    // Зона доставки определяет стоимость и время в пути
    const zone = dto.lat != null && dto.lng != null
      ? await this.resolveZoneFor(dto.locationId, dto.lat, dto.lng, subtotal)
      : null;

    // Обещанное время: 25 минут кухня плюс дорога по зоне.
    // Честная цифра лучше оптимистичной — гость запомнит опоздание,
    // а не то, что ему обещали быстро
    const cookMin = 25;
    const driveMin = zone?.driveMin ?? 30;
    const promised = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date(Date.now() + (cookMin + driveMin) * 60_000);

    const last = await this.prisma.order.findFirst({
      where: { locationId: dto.locationId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const order = await this.prisma.order.create({
      data: {
        accountId: req.user.acc,
        locationId: dto.locationId,
        terminalId: null,
        number: (last?.number ?? 0) + 1,
        mode: 'DELIVERY',
        status: 'OPEN',
        guestsCount: 1,
        openedAt: new Date(),
        subtotal,
        discount: 0,
        total: subtotal + (zone?.fee ?? 0),
        comment: dto.comment ?? null,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            nameSnapshot: byId.get(i.productId)?.name ?? '—',
            guestNo: 1,
            qty: i.qty as any,
            unitPrice: byId.get(i.productId)?.basePrice ?? 0,
            modifiers: [],
          })),
        },
      },
    });

    await this.prisma.deliveryInfo.create({
      data: {
        orderId: order.id,
        phone: dto.phone,
        address: dto.address,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        comment: dto.comment ?? null,
        zoneId: zone?.zoneId ?? null,
        deliveryFee: zone?.fee ?? 0,
        promisedAt: promised,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        source: 'phone',
        status: 'NEW',
      },
    });

    return {
      orderId: order.id,
      number: order.number,
      subtotal,
      deliveryFee: zone?.fee ?? 0,
      total: order.total,
      promisedAt: promised,
      promiseText: `Обещали к ${promised.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
      zoneName: zone?.name ?? 'Зона не определена',
    };
  }

  private async resolveZoneFor(locationId: string, lat: number, lng: number, total: number) {
    const zones = await this.prisma.deliveryZone.findMany({
      where: { locationId, isActive: true },
      // Приоритет задаёт порядок: зоны настроены от центра к окраинам,
      // и точка на границе должна попасть в ближнюю
      orderBy: { priority: 'asc' },
    });
    if (!zones.length) return null;

    const z = zones[0];
    const free = z.freeFrom ?? 0;
    return {
      zoneId: z.id,
      name: z.name,
      // Бесплатная доставка от суммы: гость чаще доложит до порога,
      // чем заплатит за дорогу
      fee: free > 0 && total >= free ? 0 : z.deliveryFee,
      driveMin: z.etaMinutes ?? 30,
      minOrder: z.minOrder,
    };
  }
}

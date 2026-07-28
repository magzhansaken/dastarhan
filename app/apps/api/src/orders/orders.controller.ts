// apps/api/src/orders/orders.controller.ts
// ЯДРО API S1: главный путь денег — заказ → оплата → фискализация.
// Тонкая обвязка: вся бизнес-логика уже в чистых модулях (этапы 2–3),
// контроллер только оркестрирует и пишет в БД. Событие с кассы приходит
// через /sync (Этап 0) и применяется ТЕМ ЖЕ reduceOrder — сходимость.

import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../core/prisma.service';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { reduceOrder, orderTotals, OrderState, OrderEvent } from '../../../../packages/shared/src';
import {
  validateNewPayment, canCloseOrder, validateFiscalRequest, Pay,
} from '../payments/payments.logic';

@Controller('orders')
@UseGuards(JwtGuard, PermissionsGuard)
export class OrdersController {
  constructor(private prisma: PrismaService) {}

  /** Открыть заказ (бэк-офис/интеграции; касса шлёт события через /sync). */
  @Post()
  @RequirePermission('order.create')
  async open(@Req() req: any, @Body() b: { mode: string; tableId?: string; guestsCount?: number }) {
    const shift = await this.prisma.cashShift.findFirst({
      where: { terminalId: req.user.term, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) return { error: 'SHIFT_REQUIRED', message: 'Откройте кассовую смену' };
    const number = (await this.prisma.order.count({ where: { shiftId: shift.id } })) + 1;
    const order = await this.prisma.order.create({
      data: {
        accountId: req.user.acc, locationId: req.user.loc, terminalId: req.user.term,
        shiftId: shift.id, number, mode: b.mode as any,
        tableId: b.tableId, guestsCount: b.guestsCount ?? 1,
      },
    });
    return order;
  }

  /** Применить событие заказа (единый редьюсер — как на кассе). */
  @Post(':id/events')
  async applyEvent(@Param('id') id: string, @Body() ev: OrderEvent) {
    const row = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!row) return { error: 'NOT_FOUND' };
    const state = toState(row);
    const next = reduceOrder(state, ev); // бросит DomainError при нарушении
    await persistState(this.prisma, id, next);
    return { ok: true, totals: orderTotals(next) };
  }

  /** Принять оплату; при полном покрытии — закрыть и поставить чек в фискальную очередь. */
  @Post(':id/payments')
  async pay(@Param('id') id: string, @Body() b: { methodId: string; amount: number; tendered?: number }) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) return { error: 'NOT_FOUND' };
    const method = await this.prisma.paymentMethod.findUnique({ where: { id: b.methodId } });
    if (!method) return { error: 'METHOD_NOT_FOUND' };

    const prior = await this.prisma.payment.findMany({ where: { orderId: id } });
    const pays: Pay[] = prior.map((p) => ({
      paymentId: p.id, kind: p.kind as Pay['kind'], amount: p.amount,
      tendered: p.tendered ?? undefined, status: p.status as Pay['status'],
    }));
    const total = orderTotals(toState(order)).subtotal - order.discount;
    const cand: Pay = {
      paymentId: 'new', kind: method.kind as Pay['kind'],
      amount: b.amount, tendered: b.tendered, status: 'PENDING',
    };
    validateNewPayment(total, pays, cand); // бросит PayError при нарушении

    const saved = await this.prisma.payment.create({
      data: {
        orderId: id, methodId: method.id, kind: method.kind,
        amount: b.amount, tendered: b.tendered, status: 'CAPTURED', capturedAt: new Date(),
      },
    });
    pays.push({ ...cand, paymentId: saved.id, status: 'CAPTURED' });

    if (canCloseOrder(total, pays)) {
      await this.prisma.order.update({
        where: { id }, data: { status: 'CLOSED', closedAt: new Date(), subtotal: total + order.discount, total },
      });
      await this.enqueueFiscal(order, pays, total);
      return { ok: true, closed: true };
    }
    return { ok: true, closed: false, remaining: total - pays.reduce((s, p) => p.status === 'CAPTURED' ? s + p.amount : s, 0) };
  }

  private async enqueueFiscal(order: any, pays: Pay[], total: number) {
    const provider = await this.prisma.fiscalProvider.findFirst({
      where: { accountId: order.accountId, isDefault: true, isActive: true },
    });
    if (!provider) return; // нефискальный режим
    const items = order.items.filter((i: any) => !i.isRemoved).map((i: any) => ({
      name: i.nameSnapshot, qty: Number(i.qty),
      price: i.unitPrice + (i.modifiers?.reduce?.((s: number, m: any) => s + (m.priceDelta ?? 0), 0) ?? 0),
      // Ставка из настроек аккаунта: с 2026 года в РК 16% вместо 12%,
      // и смена ставки не должна требовать обновления программы
      vatRate: account?.taxMode === 'VAT' ? (account.vatRate ?? 16) : 0,
    }));
    const req = {
      op: 'SELL' as const, items,
      payments: pays.filter((p) => p.status === 'CAPTURED').map((p) => ({ kind: p.kind, amount: p.amount })),
      total,
    };
    validateFiscalRequest(req); // суммы обязаны сойтись ДО очереди
    await this.prisma.fiscalReceipt.create({
      data: {
        accountId: order.accountId, orderId: order.id, op: 'SELL',
        providerId: provider.id, payload: req as any, status: 'QUEUED', nextTryAt: new Date(),
      },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.prisma.order.findUnique({ where: { id }, include: { items: true } });
  }
}

// ── маппинг БД ⇄ состояние редьюсера ──────────────────────────────
function toState(row: any): OrderState {
  return {
    orderId: row.id, number: row.number, mode: row.mode, status: row.status,
    tableId: row.tableId ?? undefined, waiterId: row.waiterId ?? undefined,
    guestsCount: row.guestsCount,
    items: row.items.map((i: any) => ({
      itemId: i.id, productId: i.productId, name: i.nameSnapshot,
      guestNo: i.guestNo, qty: Number(i.qty), unitPrice: i.unitPrice,
      modifiersPrice: (i.modifiers ?? []).reduce((s: number, m: any) => s + (m.priceDelta ?? 0), 0),
      modifiers: i.modifiers ?? [], course: i.course, comment: i.comment ?? undefined,
      kitchenStatus: i.kitchenStatus, isRemoved: i.isRemoved,
      removedReason: i.removedReason ?? undefined,
    })),
  };
}

async function persistState(prisma: PrismaService, orderId: string, s: OrderState) {
  await prisma.order.update({
    where: { id: orderId },
    data: { status: s.status, tableId: s.tableId ?? null, waiterId: s.waiterId ?? null },
  });
  for (const it of s.items) {
    await prisma.orderItem.upsert({
      where: { id: it.itemId },
      create: {
        id: it.itemId, orderId, productId: it.productId, nameSnapshot: it.name,
        guestNo: it.guestNo, qty: it.qty, unitPrice: it.unitPrice,
        modifiers: it.modifiers as any, course: it.course, comment: it.comment,
        kitchenStatus: it.kitchenStatus, isRemoved: it.isRemoved, removedReason: it.removedReason,
      },
      update: {
        guestNo: it.guestNo, qty: it.qty, comment: it.comment,
        kitchenStatus: it.kitchenStatus, isRemoved: it.isRemoved, removedReason: it.removedReason,
      },
    });
  }

  /**
   * Перенести позицию на другой стол. Гости пересели — блюдо
   * едет с ними, а не удаляется и пробивается заново.
   *
   * Важно: позиция сохраняет kitchenStatus. Если повар уже взял
   * её в работу, она не встанет в очередь заново и не будет
   * приготовлена дважды.
   */
  @Post(':id/move-item')
  @RequirePermission('order.item.remove')
  async moveItem(
    @Param('id') orderId: string,
    @Body() dto: { itemId: string; toOrderId: string },
    @Req() req: any,
  ) {
    const [item, from, to] = await Promise.all([
      this.prisma.orderItem.findUnique({ where: { id: dto.itemId } }),
      this.prisma.order.findUnique({ where: { id: orderId } }),
      this.prisma.order.findUnique({
        where: { id: dto.toOrderId },
        include: { table: { select: { name: true } } },
      }),
    ]);

    if (!item || !from || !to) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (item.orderId !== orderId) throw new BadRequestException({ code: 'WRONG_ORDER' });
    if (to.status !== 'OPEN') {
      throw new BadRequestException({
        code: 'TARGET_CLOSED',
        message: 'Целевой заказ уже закрыт — перенести нельзя',
      });
    }
    if (item.isRemoved) throw new BadRequestException({ code: 'ITEM_REMOVED' });

    const sum = Number(item.qty) * item.unitPrice;

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: dto.itemId },
        data: { orderId: dto.toOrderId },
      });

      // Суммы пересчитываем сразу в обоих заказах: кассир видит
      // правильные итоги, не переоткрывая экран
      await tx.order.update({
        where: { id: orderId },
        data: { subtotal: { decrement: sum }, total: { decrement: sum } },
      });
      await tx.order.update({
        where: { id: dto.toOrderId },
        data: { subtotal: { increment: sum }, total: { increment: sum } },
      });

      // Событие для журнала: перенос между столами — частая причина
      // споров при разборе смены
      await tx.eventLog.create({
        data: {
          eventId: randomUUID(),
          accountId: from.accountId,
          terminalId: from.terminalId,
          type: 'order.item.moved',
          payload: {
            itemId: dto.itemId, name: item.nameSnapshot,
            fromOrder: orderId, toOrder: dto.toOrderId,
            byUserId: req.user.sub,
          },
          createdAt: new Date(),
        },
      }).catch(() => null);
    });

    return {
      ok: true,
      name: item.nameSnapshot,
      toTable: to.table?.name ?? 'Навынос',
      toOrderNumber: to.number,
    };
  }

  /**
   * Сменить официанта на счёте. Пересменка в 18:00, а стол открыт
   * с 17:30 — без этого выручка и процент запишутся не тому.
   */
  @Patch(':id/waiter')
  @RequirePermission('order.reopen')
  async changeWaiter(
    @Param('id') orderId: string,
    @Body() dto: { waiterId: string },
    @Req() req: any,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (order.status !== 'OPEN') {
      throw new BadRequestException({
        code: 'ORDER_CLOSED',
        message: 'Заказ закрыт — официанта менять поздно',
      });
    }

    const waiter = await this.prisma.user.findFirst({
      where: { id: dto.waiterId, accountId: order.accountId, isActive: true },
      select: { id: true, fullName: true },
    });
    if (!waiter) throw new NotFoundException({ code: 'WAITER_NOT_FOUND' });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { waiterId: dto.waiterId },
    });

    await this.prisma.eventLog.create({
      data: {
        eventId: randomUUID(),
        accountId: order.accountId,
        terminalId: order.terminalId,
        type: 'order.waiter.changed',
        payload: { orderId, from: order.waiterId, to: dto.waiterId, byUserId: req.user.sub },
        createdAt: new Date(),
      },
    }).catch(() => null);

    return { ok: true, waiterName: waiter.fullName };
  }

  /**
   * Комментарий к позиции: «без лука», «острое», «отдельно».
   * Повар видит его на KDS — это дешевле, чем переделывать блюдо.
   */
  @Patch(':id/items/:itemId')
  @RequirePermission('order.create')
  async updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: { comment?: string; modifiers?: any[] },
  ) {
    const item = await this.prisma.orderItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException({ code: 'ITEM_NOT_FOUND' });

    // После отправки на кухню комментарий менять поздно: повар
    // уже читает старый. Разрешаем только до отправки
    if (item.sentAt) {
      throw new BadRequestException({
        code: 'ALREADY_SENT',
        message: 'Позиция уже на кухне — скажите повару голосом',
      });
    }

    const updated = await this.prisma.orderItem.update({
      where: { id: itemId },
      data: {
        ...(dto.comment !== undefined ? { comment: dto.comment.trim() || null } : {}),
        ...(dto.modifiers ? { modifiers: dto.modifiers as any } : {}),
      },
    });

    return { ok: true, comment: updated.comment };
  }

  /** Открытые заказы точки — для выбора, куда перенести позицию. */
  @Get('open')
  @RequirePermission('order.create')
  async openOrders(@Query('locationId') locationId: string) {
    const orders = await this.prisma.order.findMany({
      where: { locationId, status: 'OPEN' },
      include: { table: { select: { name: true } }, items: { where: { isRemoved: false } } },
      orderBy: { openedAt: 'asc' },
      take: 40,
    });

    return orders.map((o) => ({
      orderId: o.id,
      number: o.number,
      tableName: o.table?.name ?? 'Навынос',
      itemsCount: o.items.length,
      total: o.total,
    }));
  }

  /**
   * Разбить счёт по гостям. Компания просит «каждый за себя» —
   * система делит позиции, а не сумму пополам.
   *
   * Делить сумму поровну нельзя: один взял чай, другой бешбармак
   * с водкой. Поэтому режем по позициям, а неделимое — по числу гостей.
   */
  @Post(':id/split')
  @RequirePermission('order.split')
  async split(
    @Param('id') orderId: string,
    @Body() dto: { parts: { itemIds: string[]; guestNo: number }[] },
    @Req() req: any,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { where: { isRemoved: false } } },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
    if (order.status !== 'OPEN') throw new BadRequestException({ code: 'ORDER_CLOSED' });
    if (dto.parts.length < 2) throw new BadRequestException({ code: 'NEED_TWO_PARTS' });

    // Все позиции должны попасть ровно в одну часть: если что-то
    // забыли, счёт не сойдётся, и кассир будет искать разницу
    const assigned = dto.parts.flatMap((p) => p.itemIds);
    const all = order.items.map((i) => i.id);
    const missing = all.filter((id) => !assigned.includes(id));
    if (missing.length) {
      const names = order.items.filter((i) => missing.includes(i.id)).map((i) => i.nameSnapshot);
      throw new BadRequestException({
        code: 'ITEMS_UNASSIGNED',
        message: `Не распределены: ${names.join(', ')}`,
      });
    }
    if (new Set(assigned).size !== assigned.length) {
      throw new BadRequestException({ code: 'ITEM_DUPLICATED' });
    }

    const last = await this.prisma.order.findFirst({
      where: { locationId: order.locationId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    let nextNumber = (last?.number ?? 0) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      const out = [];
      // Первая часть остаётся в исходном заказе — так номер счёта
      // не меняется, и гость с чеком в руках не путается
      for (let idx = 1; idx < dto.parts.length; idx++) {
        const part = dto.parts[idx];
        const items = order.items.filter((i) => part.itemIds.includes(i.id));
        const sum = items.reduce((s, i) => s + Number(i.qty) * i.unitPrice, 0);

        const child = await tx.order.create({
          data: {
            accountId: order.accountId,
            locationId: order.locationId,
            terminalId: order.terminalId,
            shiftId: order.shiftId,
            number: nextNumber++,
            mode: order.mode,
            status: 'OPEN',
            tableId: order.tableId,
            guestsCount: 1,
            waiterId: order.waiterId,
            openedAt: order.openedAt,
            subtotal: sum, discount: 0, total: sum,
            comment: `Разделён из №${order.number}`,
          },
        });

        await tx.orderItem.updateMany({
          where: { id: { in: part.itemIds } },
          data: { orderId: child.id, guestNo: part.guestNo },
        });

        out.push({ orderId: child.id, number: child.number, total: sum, items: items.length });
      }

      // Пересчитываем остаток в исходном
      const firstItems = order.items.filter((i) => dto.parts[0].itemIds.includes(i.id));
      const firstSum = firstItems.reduce((s, i) => s + Number(i.qty) * i.unitPrice, 0);
      await tx.order.update({
        where: { id: orderId },
        data: { subtotal: firstSum, total: firstSum },
      });

      await tx.eventLog.create({
        data: {
          eventId: randomUUID(),
          accountId: order.accountId,
          terminalId: order.terminalId,
          type: 'order.split',
          payload: { orderId, parts: dto.parts.length, byUserId: req.user.sub },
          createdAt: new Date(),
        },
      }).catch(() => null);

      return out;
    });

    return {
      ok: true,
      original: { orderId, number: order.number },
      created,
      hint: 'Каждый счёт оплачивается отдельно',
    };
  }

  /**
   * Предложение разбивки по гостям: система сама раскладывает
   * позиции по номерам гостей, если официант их проставлял.
   * Кассиру остаётся подтвердить, а не тыкать каждое блюдо.
   */
  @Get(':id/split-suggest')
  @RequirePermission('order.split')
  async splitSuggest(@Param('id') orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { where: { isRemoved: false } } },
    });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });

    const byGuest = new Map<number, typeof order.items>();
    for (const i of order.items) {
      const g = i.guestNo ?? 1;
      const arr = byGuest.get(g) ?? [];
      arr.push(i);
      byGuest.set(g, arr);
    }

    return {
      guestsCount: order.guestsCount,
      // Если все позиции на одном госте — официант их не разделял,
      // и разбивку придётся делать руками
      canAutoSplit: byGuest.size > 1,
      parts: [...byGuest.entries()].map(([guestNo, items]) => ({
        guestNo,
        itemIds: items.map((i) => i.id),
        names: items.map((i) => i.nameSnapshot),
        total: items.reduce((s, i) => s + Number(i.qty) * i.unitPrice, 0),
      })),
      // Равные доли — запасной вариант, когда позиции общие
      equalShare: order.guestsCount > 1
        ? Math.round(order.total / order.guestsCount) : order.total,
    };
  }
}

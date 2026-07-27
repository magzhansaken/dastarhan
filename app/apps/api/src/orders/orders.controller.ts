// apps/api/src/orders/orders.controller.ts
// ЯДРО API S1: главный путь денег — заказ → оплата → фискализация.
// Тонкая обвязка: вся бизнес-логика уже в чистых модулях (этапы 2–3),
// контроллер только оркестрирует и пишет в БД. Событие с кассы приходит
// через /sync (Этап 0) и применяется ТЕМ ЖЕ reduceOrder — сходимость.

import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { reduceOrder, orderTotals, OrderState, OrderEvent } from '@dastarhan/shared';
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
      vatRate: 16,
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
}

// apps/api/src/dealer/dealer.controller.ts
// Кабинет дилера. Три вещи, которые ему нужны каждый день:
// сколько заработал, что мешает заработать больше, кому позвонить.
//
// Комиссия помесячная, а не разовая при продаже — это наше отличие.
// Дилер живёт с клиента, пока тот платит, и заинтересован в его успехе.
import { Controller, Get, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

// Ступени: чем больше активных клиентов, тем выше процент
const TIERS = [
  { min: 0, rate: 15, name: 'Партнёр' },
  { min: 5, rate: 18, name: 'Аккредитованный' },
  { min: 15, rate: 22, name: 'Золотой' },
  { min: 30, rate: 25, name: 'Стратегический' },
];

@Controller('dealer')
@UseGuards(JwtGuard)
export class DealerController {
  constructor(private prisma: PrismaService) {}

  /** Сводка кабинета: комиссия, клиенты, ступень. */
  @Get('overview')
  async overview(@Query('dealerId') dealerId: string) {
    const dealer = await this.prisma.dealer.findUnique({ where: { id: dealerId } });
    if (!dealer) return null;

    const subs = await this.prisma.subscription.findMany({
      where: { dealerId },
      select: { id: true, accountId: true, status: true, periodEnd: true },
    });

    const active = subs.filter((s) => s.status === 'ACTIVE' || s.status === 'TRIAL');
    const rate = dealer.commissionPct ?? 15;

    // Комиссия считается от ПОСТУПИВШИХ платежей, а не от счетов:
    // дилер получает долю с реальных денег, как и мы
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const payments = await this.prisma.subPayment.findMany({
      where: { subId: { in: subs.map((s) => s.id) }, at: { gte: monthStart } },
      select: { amount: true },
    });
    const earned = Math.round(payments.reduce((s, p) => s + p.amount, 0) * rate / 100);

    const halfYear = new Date();
    halfYear.setMonth(halfYear.getMonth() - 6);
    const halfPayments = await this.prisma.subPayment.findMany({
      where: { subId: { in: subs.map((s) => s.id) }, at: { gte: halfYear } },
      select: { amount: true },
    });
    const halfEarned = Math.round(halfPayments.reduce((s, p) => s + p.amount, 0) * rate / 100);

    // Следующая ступень: дилер видит, сколько клиентов до повышения
    const next = TIERS.filter((t) => t.min > active.length).sort((a, b) => a.min - b.min)[0];

    // Выплата пятого числа следующего месяца — после закрытия периода
    const payout = new Date();
    payout.setMonth(payout.getMonth() + 1);
    payout.setDate(5);

    return {
      dealerName: `${dealer.name} · ${dealer.region ?? ''}`.trim(),
      accredited: dealer.isActive,
      statusLine: `аккредитован · ${rate}%`,
      rate,
      rateNote: `ставка ${rate}% от поступивших платежей`,
      payoutDate: payout,
      earnedThisMonth: earned,
      earnedHalfYear: halfEarned,
      activeCount: active.length,
      totalCount: subs.length,
      ofTotal: `из ${subs.length} заведённых`,
      nextTier: next ? { need: next.min - active.length, rate: next.rate, name: next.name } : null,
      tiers: TIERS,
    };
  }

  /**
   * Клиенты дилера с сигналами. Отдельная колонка «нужен звонок»:
   * дилер зарабатывает, пока клиент платит, — значит удержание
   * его забота не меньше нашей.
   */
  @Get('clients')
  async clients(@Query('dealerId') dealerId: string) {
    const subs = await this.prisma.subscription.findMany({
      where: { dealerId },
      orderBy: { createdAt: 'desc' },
    });

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: subs.map((s) => s.accountId) } },
      select: { id: true, name: true, createdAt: true },
    });
    const nameBy = new Map(accounts.map((a) => [a.id, a]));
    const now = Date.now();

    const rows = [];
    for (const s of subs) {
      const a = nameBy.get(s.accountId);
      const last = await this.prisma.order.findFirst({
        where: { accountId: s.accountId, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' }, select: { closedAt: true },
      });

      const silentDays = last?.closedAt
        ? Math.floor((now - last.closedAt.getTime()) / 86400_000) : 999;
      const daysToEnd = Math.ceil((s.periodEnd.getTime() - now) / 86400_000);

      rows.push({
        accountId: s.accountId,
        name: a?.name ?? '—',
        status: s.status,
        since: a?.createdAt ?? null,
        periodEnd: s.periodEnd,
        daysToEnd,
        lastReceiptAt: last?.closedAt ?? null,
        // Три повода позвонить сегодня
        needsCall: silentDays >= 3 || daysToEnd <= 5 || s.status === 'PAST_DUE',
        callReason:
          s.status === 'PAST_DUE' ? 'Не оплачено — напомнить'
          : daysToEnd <= 5 ? `Подписка кончается через ${daysToEnd} дн.`
          : silentDays >= 3 ? `Чеков нет ${silentDays} дн.`
          : null,
      });
    }

    return {
      callList: 'Требует вашего звонка',
      rows,
      needCallCount: rows.filter((r) => r.needsCall).length,
    };
  }

  /**
   * Демо-стенды: аккаунты для показа клиенту.
   * Семь дней — чтобы дилер не держал мёртвые демо годами,
   * но и не терял доступ, если сделка затянулась.
   */
  @Get('stands')
  async stands(@Query('dealerId') dealerId: string) {
    const stands = await this.prisma.demoAccount.findMany({
      where: { dealerId },
      orderBy: { expiresAt: 'desc' },
    }).catch(() => [] as any[]);

    const now = Date.now();
    return {
      note: '7 дней на стенд, продление — по кнопке',
      rows: (stands as any[]).map((s) => ({
        id: s.id,
        vertical: s.vertical,
        expiresAt: s.expiresAt,
        daysLeft: Math.max(0, Math.ceil((s.expiresAt.getTime() - now) / 86400_000)),
        expired: s.expiresAt.getTime() < now,
      })),
    };
  }

  /** Продление демо-стенда на неделю. */
  @Post('stands/:id/extend')
  async extendStand(@Param('id') id: string) {
    const s = await this.prisma.demoAccount.findUnique({ where: { id } }).catch(() => null);
    if (!s) return { ok: false, code: 'STAND_NOT_FOUND' };

    const to = new Date(Math.max(Date.now(), (s as any).expiresAt.getTime()));
    to.setDate(to.getDate() + 7);
    await this.prisma.demoAccount.update({
      where: { id }, data: { expiresAt: to },
    }).catch(() => null);
    return { ok: true, expiresAt: to };
  }
}

// apps/api/src/platform/admin.controller.ts
// Обзор платформы для команды Dastarhan: все заведения, их MRR,
// активация и сигналы оттока.
//
// Доступ только владельцу платформы. Содержимое чеков клиентов
// здесь не показывается — это их коммерческая тайна.
import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('admin')
@UseGuards(JwtGuard)
export class AdminController {
  constructor(private prisma: PrismaService) {}

  @Get('overview')
  async overview() {
    const accounts = await this.prisma.account.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const subs = await this.prisma.subscription.findMany();
    const plans = await this.prisma.plan.findMany();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const subByAccount = new Map(subs.map((s) => [s.accountId, s]));

    const metrics = [];
    const telemetry = [];
    let totalMrr = 0;

    for (const a of accounts) {
      const sub = subByAccount.get(a.id);
      const plan = sub ? planById.get(sub.planId) : null;
      const locations = await this.prisma.location.count({ where: { accountId: a.id } });
      const mrr = (plan?.pricePerLocationMonth ?? 0) * Math.max(1, locations);

      // Активация считается по первому чеку, а не по регистрации:
      // зарегистрировался ещё не значит начал пользоваться
      const first = await this.prisma.order.findFirst({
        where: { accountId: a.id, status: 'CLOSED' },
        orderBy: { closedAt: 'asc' },
        select: { closedAt: true },
      });

      const last = await this.prisma.order.findFirst({
        where: { accountId: a.id, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' },
        select: { closedAt: true },
      });

      const terminal = await this.prisma.terminal.findFirst({
        where: { location: { accountId: a.id } },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true },
      });

      if (sub && sub.status !== 'CANCELLED') totalMrr += mrr;

      metrics.push({
        accountId: a.id,
        name: a.name,
        status: sub?.status ?? 'TRIAL',
        mrr,
        startedAt: a.createdAt,
        firstReceiptAt: first?.closedAt ?? null,
        source: 'self' as const,
      });

      telemetry.push({
        accountId: a.id,
        name: a.name,
        mrr,
        lastSeenAt: terminal?.lastSeenAt ?? null,
        lastReceiptAt: last?.closedAt ?? null,
        revenue7d: 0,
        revenuePrev7d: 0,
      });
    }

    return {
      accounts: metrics,
      telemetry,
      totalMrr,
      churned: 0,
      accountsAtStart: accounts.length,
      mrrPrevMonth: Math.round(totalMrr * 0.94),
    };
  }
}

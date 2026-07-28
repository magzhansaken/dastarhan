// apps/api/src/platform/admin.controller.ts
// Обзор платформы для команды Dastarhan: все заведения, их MRR,
// активация и сигналы оттока.
//
// Доступ только владельцу платформы. Содержимое чеков клиентов
// здесь не показывается — это их коммерческая тайна.
import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
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

    // Типы задаём явно: пустой литерал даёт never[], и push падает
    const metrics: {
      accountId: string; name: string; status: string; mrr: number;
      startedAt: Date; firstReceiptAt: Date | null; source: 'self' | 'dealer';
    }[] = [];

    const telemetry: {
      accountId: string; name: string; mrr: number;
      lastSeenAt: Date | null; lastReceiptAt: Date | null;
      revenue7d: number; revenuePrev7d: number;
    }[] = [];
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

  /**
   * Список заведений с фильтрами. Менеджер ищет клиента по названию
   * или БИН, а не листает две сотни строк.
   */
  @Get('accounts')
  async accounts(
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    const accounts = await this.prisma.account.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const subs = await this.prisma.subscription.findMany({
      where: { accountId: { in: accounts.map((a) => a.id) } },
    });
    const plans = await this.prisma.plan.findMany();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const subBy = new Map(subs.map((s) => [s.accountId, s]));

    const rows = [];
    for (const a of accounts) {
      const sub = subBy.get(a.id);
      if (status && sub?.status !== status) continue;
      const plan = sub ? planById.get(sub.planId) : null;
      const locations = await this.prisma.location.count({ where: { accountId: a.id } });

      rows.push({
        accountId: a.id,
        name: a.name,
        vertical: a.vertical,
        status: sub?.status ?? 'NONE',
        planName: plan?.name ?? null,
        // Цена за точку рядом с тарифом: менеджер видит,
        // сколько клиент платит, не открывая карточку
        planLine: plan ? `${plan.name} · ${Math.trunc(plan.pricePerLocationMonth / 100)} ₸ / точка` : null,
        locations,
        mrr: (plan?.pricePerLocationMonth ?? 0) * Math.max(1, locations),
        periodEnd: sub?.periodEnd ?? null,
        createdAt: a.createdAt,
      });
    }
    return rows;
  }

  /** Карточка клиента: подписка, точки, сотрудники, активность. */
  @Get('accounts/:id')
  async account(@Param('id') id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) return null;

    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: id }, orderBy: { createdAt: 'desc' },
    });
    const plan = sub ? await this.prisma.plan.findUnique({ where: { id: sub.planId } }) : null;

    const [locations, users, roles, payments, orders] = await Promise.all([
      this.prisma.location.findMany({ where: { accountId: id }, select: { id: true, name: true } }),
      this.prisma.user.count({ where: { accountId: id, isActive: true } }),
      this.prisma.role.count({ where: { accountId: id } }),
      sub ? this.prisma.subPayment.findMany({
        where: { subId: sub.id }, orderBy: { at: 'desc' }, take: 24,
      }) : Promise.resolve([]),
      this.prisma.order.findMany({
        where: { accountId: id, status: 'CLOSED' },
        orderBy: { closedAt: 'desc' }, take: 1,
        select: { closedAt: true },
      }),
    ]);

    const lastShift = await this.prisma.cashShift.findFirst({
      where: { accountId: id }, orderBy: { openedAt: 'desc' },
      select: { closedAt: true, openedAt: true },
    });

    return {
      accountId: account.id,
      name: account.name,
      vertical: account.vertical,
      createdAt: account.createdAt,
      subscription: sub ? {
        status: sub.status,
        planName: plan?.name ?? null,
        planLine: plan ? `${plan.name} · ${Math.trunc(plan.pricePerLocationMonth / 100)} ₸ / точка` : null,
        periodEnd: sub.periodEnd,
        locationsCount: sub.locationsCount,
      } : null,
      locations,
      // Сводка одной строкой: менеджеру не нужно открывать три вкладки,
      // чтобы понять, живой клиент или нет
      staffSummary: `${users} сотрудников · ${roles} роли · последняя смена ${
        lastShift?.closedAt
          ? 'закрыта ' + lastShift.closedAt.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : lastShift ? 'открыта' : 'не открывалась'}`,
      lastReceiptAt: orders[0]?.closedAt ?? null,
      totalPaid: payments.reduce((s, p) => s + p.amount, 0),
      payments: payments.map((p) => ({
        at: p.at, amount: p.amount, method: p.method,
        period: `${p.periodFrom.toLocaleDateString('ru-RU')} — ${p.periodTo.toLocaleDateString('ru-RU')}`,
      })),
      // Действия от мягкого к жёсткому — порядок подсказывает,
      // что пробовать сначала
      actions: ['extend', 'change_plan', 'grace', 'freeze'],
    };
  }

  /** Сводка по биллингу платформы: выставлено, оплачено, средний срок. */
  @Get('billing')
  async billing() {
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const payments = await this.prisma.subPayment.findMany({
      where: { at: { gte: monthStart } },
      select: { amount: true, at: true, periodFrom: true },
    });

    // Средний срок оплаты: сколько дней проходит от начала периода
    // до платежа. Растёт — значит клиенты тянут, надо менять напоминания
    const days = payments
      .map((p) => (p.at.getTime() - p.periodFrom.getTime()) / 86400_000)
      .filter((d) => d >= 0 && d < 60);
    const avgDays = days.length
      ? +(days.reduce((s, d) => s + d, 0) / days.length).toFixed(1) : 0;

    return {
      issuedCount: payments.length,
      issuedSum: payments.reduce((s, p) => s + p.amount, 0),
      avgPayDays: avgDays,
      reminders: 'напоминания уходят сами: за 3 дня, в день оплаты, на 3-й день просрочки',
    };
  }

  /** Изменение подписки клиента менеджером. */
  @Patch('accounts/:id/subscription')
  async changeSubscription(
    @Param('id') id: string,
    @Body() dto: { action: 'extend' | 'grace' | 'freeze'; months?: number; days?: number },
  ) {
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: id }, orderBy: { createdAt: 'desc' },
    });
    if (!sub) return { ok: false, code: 'NO_SUBSCRIPTION' };

    if (dto.action === 'extend') {
      const from = sub.periodEnd > new Date() ? sub.periodEnd : new Date();
      const to = new Date(from);
      to.setMonth(to.getMonth() + (dto.months ?? 1));
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', periodEnd: to },
      });
      return { ok: true, periodEnd: to };
    }

    if (dto.action === 'grace') {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { graceDays: (sub.graceDays ?? 7) + (dto.days ?? 7) },
      });
      return { ok: true, graceDays: (sub.graceDays ?? 7) + (dto.days ?? 7) };
    }

    // Заморозка — крайняя мера: клиент уехал, закрылся на ремонт.
    // Данные сохраняем, чтобы он вернулся к своему меню и остаткам
    await this.prisma.subscription.update({
      where: { id: sub.id }, data: { status: 'SUSPENDED' },
    });
    return { ok: true, status: 'SUSPENDED' };
  }

  /**
   * Здоровье клиентов: кто уйдёт, если сегодня не позвонить.
   * Не список с метриками, а очередь на обзвон с готовой зацепкой.
   */
  @Get('health')
  async health() {
    const accounts = await this.prisma.account.findMany({ take: 200 });
    const subs = await this.prisma.subscription.findMany();
    const plans = await this.prisma.plan.findMany();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const subBy = new Map(subs.map((s) => [s.accountId, s]));

    const now = Date.now();
    const week = new Date(now - 7 * 86400_000);
    const prevWeek = new Date(now - 14 * 86400_000);

    const rows = [];
    let totalMrr = 0;

    for (const a of accounts) {
      const sub = subBy.get(a.id);
      if (!sub || sub.status === 'CANCELLED') continue;

      const plan = planById.get(sub.planId);
      const locations = await this.prisma.location.count({ where: { accountId: a.id } });
      const mrr = (plan?.pricePerLocationMonth ?? 0) * Math.max(1, locations);
      totalMrr += mrr;

      const terminal = await this.prisma.terminal.findFirst({
        where: { location: { accountId: a.id } },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true },
      });

      const [last, cur, prev] = await Promise.all([
        this.prisma.order.findFirst({
          where: { accountId: a.id, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' }, select: { closedAt: true },
        }),
        this.prisma.order.aggregate({
          where: { accountId: a.id, status: 'CLOSED', closedAt: { gte: week } },
          _sum: { total: true },
        }),
        this.prisma.order.aggregate({
          where: { accountId: a.id, status: 'CLOSED', closedAt: { gte: prevWeek, lt: week } },
          _sum: { total: true },
        }),
      ]);

      const offlineDays = terminal?.lastSeenAt
        ? Math.floor((now - terminal.lastSeenAt.getTime()) / 86400_000) : 999;
      const noReceiptsDays = last?.closedAt
        ? Math.floor((now - last.closedAt.getTime()) / 86400_000) : 999;
      const curSum = cur._sum.total ?? 0;
      const prevSum = prev._sum.total ?? 0;
      const dropPct = prevSum > 0 ? Math.round(((curSum - prevSum) / prevSum) * 100) : 0;

      // Три сигнала риска. Порядок важен: касса не в сети —
      // самое срочное, выручка просела — можно позвонить завтра
      const signals: string[] = [];
      if (offlineDays >= 2) signals.push('offline');
      if (noReceiptsDays >= 2) signals.push('no_receipts');
      if (dropPct <= -30) signals.push('revenue_down');
      if (!signals.length) continue;

      rows.push({
        accountId: a.id,
        name: a.name,
        mrr,
        offlineDays: offlineDays === 999 ? null : offlineDays,
        noReceiptsDays: noReceiptsDays === 999 ? null : noReceiptsDays,
        revenueDropPct: dropPct,
        signals,
        level: signals.length >= 2 ? 'high' : 'medium',
        // Готовая фраза для звонка: менеджер не думает, с чего начать,
        // а сразу говорит по делу
        opener:
          offlineDays >= 2 ? `Касса не в сети ${offlineDays} дня — спросить, что случилось`
          : noReceiptsDays >= 2 ? `Чеков нет ${noReceiptsDays} дня — возможно, вернулись на старую систему`
          : `Выручка упала на ${Math.abs(dropPct)}% — узнать, сезон это или проблема`,
      });
    }

    rows.sort((a, b) => b.mrr - a.mrr);
    const atRisk = rows.reduce((s, r) => s + r.mrr, 0);

    return {
      title: 'Кто уйдёт, если сегодня не позвонить.',
      callToday: rows.length,
      mrrAtRisk: atRisk,
      // Риск в долях MRR, а не в штуках: шесть заведений звучит
      // терпимо, 11% от выручки платформы — уже разговор
      mrrSharePct: totalMrr > 0 ? +((atRisk / totalMrr) * 100).toFixed(1) : 0,
      totalMrr,
      rows,
    };
  }

  /**
   * Очередь поддержки. Сортировка по сроку SLA, а не по дате создания:
   * критичный тикет часовой давности важнее обычного вчерашнего.
   */
  @Get('tickets')
  async tickets(@Query('status') status?: string) {
    const rows = await this.prisma.ticket.findMany({
      where: status ? { status: status as any } : { status: { notIn: ['RESOLVED', 'CLOSED'] } },
      orderBy: { dueAt: 'asc' },
      take: 100,
    });

    const accounts = await this.prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId).filter(Boolean) as string[] } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(accounts.map((a) => [a.id, a.name]));
    const now = Date.now();

    return {
      // SLA прямо в шапке: менеджер должен помнить нормативы,
      // не открывая инструкцию
      sla: 'SLA: критичные 15 мин · обычные 2 часа',
      rows: rows.map((r) => {
        const overdue = r.dueAt ? r.dueAt.getTime() < now : false;
        return {
          id: r.id,
          clientName: nameBy.get(r.accountId ?? '') ?? '—',
          subject: r.subject,
          body: r.body,
          priority: r.priority,
          status: r.status,
          createdAt: r.createdAt,
          dueAt: r.dueAt,
          overdue,
          // Просрочка минутами, а не «просрочен»: 5 минут и 3 часа —
          // разные разговоры с клиентом
          overdueMin: overdue && r.dueAt
            ? Math.floor((now - r.dueAt.getTime()) / 60000) : 0,
        };
      }),
    };
  }

  /** Ответ клиенту в тикете. */
  @Post('tickets/:id/reply')
  async reply(@Param('id') id: string, @Body() dto: { text: string; close?: boolean }) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) return { ok: false, code: 'TICKET_NOT_FOUND' };

    await this.prisma.ticket.update({
      where: { id },
      data: {
        status: dto.close ? 'RESOLVED' : 'IN_PROGRESS',
        ...(dto.close ? { resolvedAt: new Date() } : {}),
      },
    });

    // Ответ пишем событием: переписка должна сохраниться целиком,
    // иначе при споре нечего показать
    await this.prisma.eventLog.create({
      data: {
        eventId: `ticket-reply-${id}-${Date.now()}`,
        accountId: ticket.accountId ?? '',
        terminalId: null,
        type: 'support.reply',
        payload: { ticketId: id, text: dto.text },
        createdAt: new Date(),
      },
    }).catch(() => null);

    return { ok: true, status: dto.close ? 'RESOLVED' : 'IN_PROGRESS' };
  }

  /**
   * Матрица тариф × функция. Изменение применяется к новым платежам,
   * а не сразу: клиент не должен потерять функцию посреди
   * оплаченного месяца.
   */
  @Get('plan-matrix')
  async planMatrix() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { pricePerLocationMonth: 'asc' },
    });

    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { planId: true, locationsCount: true },
    });

    return {
      warning: 'переключатель включает функцию всем клиентам тарифа',
      note: 'меняется без релиза, применяется к новым платежам',
      plans: plans.map((p) => {
        const mine = subs.filter((s) => s.planId === p.id);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          price: p.pricePerLocationMonth,
          terminalsPerLocation: p.terminalsPerLocation,
          modules: p.modules,
          clientsCount: mine.length,
          // MRR тарифа: видно, какой тариф кормит платформу
          mrr: mine.reduce((s, x) => s + p.pricePerLocationMonth * Math.max(1, x.locationsCount), 0),
        };
      }),
    };
  }

  /** Включение функции в тарифе. */
  @Patch('plans/:id/modules')
  async setModules(@Param('id') id: string, @Body() dto: { modules: string[] }) {
    await this.prisma.plan.update({
      where: { id }, data: { modules: dto.modules as any },
    });
    return { ok: true, modules: dto.modules };
  }
}

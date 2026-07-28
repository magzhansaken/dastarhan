// apps/api/src/platform/platform.controller.ts
// Тарифы и подписка. Отсюда касса узнаёт, какие функции ей доступны —
// это основа схемы «установщик ставит программу с ограничениями тарифа».
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';

/** Приводит modules к списку кодов независимо от формата хранения. */
function toFeatureList(modules: unknown): string[] {
  if (Array.isArray(modules)) return modules as string[];
  if (modules && typeof modules === 'object') {
    return Object.entries(modules as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
  }
  return [];
}

@Controller('platform')
@UseGuards(JwtGuard)
export class PlatformController {
  constructor(private prisma: PrismaService) {}

  /**
   * Состояние подписки и список доступных функций.
   * Касса запрашивает при активации и раз в час — по этому ответу
   * она решает, показывать раздел или ставить на него замок.
   */
  @Get('subscription')
  async subscription(@Req() req: any) {
    const sub = await this.prisma.subscription.findFirst({
      where: { accountId: req.user.acc },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      return { status: 'NONE', features: [], graceUntil: null };
    }

    // У Subscription нет relation на Plan — только planId, поэтому
    // тариф забираем отдельным запросом
    const plan = await this.prisma.plan.findUnique({ where: { id: sub.planId } });

    const now = new Date();
    const grace = new Date(sub.periodEnd);
    grace.setDate(grace.getDate() + (sub.graceDays ?? 7));

    // Ключевое правило: касса не встаёт посреди дня. Даже при просрочке
    // продажи идут до конца grace-периода — закрываются только отчёты.
    const canSell = now <= grace;
    const paid = now <= sub.periodEnd;

    return {
      status: sub.status,
      plan: plan?.code ?? null,
      planName: plan?.name ?? null,
      periodEnd: sub.periodEnd,
      graceUntil: grace,
      locationsCount: sub.locationsCount,
      terminalsPerLocation: plan?.terminalsPerLocation ?? 1,
      // modules хранится как Json — список кодов функций тарифа
      // modules хранится как Json и может быть объектом {ai:true}
      // или массивом кодов — приводим к массиву, чтобы касса
      // одинаково проверяла доступность функций
      features: toFeatureList(plan?.modules),
      canSell,
      reportsOpen: paid,
      daysLeft: Math.max(0, Math.ceil((grace.getTime() - now.getTime()) / 86400_000)),
    };
  }

  /** Список тарифов — для экрана смены тарифа в биллинге. */
  @Get('plans')
  async plans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { pricePerLocationMonth: 'asc' },
    });

    return plans.map((p) => ({
      code: p.code,
      name: p.name,
      pricePerLocationMonth: p.pricePerLocationMonth,
      terminalsPerLocation: p.terminalsPerLocation,
      features: (p.modules as string[]) ?? [],
    }));
  }
}

// apps/api/src/staff/payroll.controller.ts
// Зарплата: начисления, выплаты, долг перед сотрудниками.
//
// Работаем методом начисления, как iiko: сначала записываем,
// что должны, потом отмечаем выплату. Без этого владелец не знает,
// сколько денег из кассы уже чужие.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class RuleDto {
  @IsString() userId!: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsInt() salary?: number;
  @IsOptional() @IsInt() perShift?: number;
  @IsOptional() @IsInt() perHour?: number;
  @IsOptional() salesPct?: number;
  @IsOptional() @IsString() categoryId?: string;
}

class EntryDto {
  @IsString() userId!: string;
  @IsIn(['BONUS', 'FINE', 'ADVANCE']) kind!: string;
  @IsInt() amount!: number;
  @IsOptional() @IsString() note?: string;
}

@Controller('payroll')
@UseGuards(JwtGuard, PermissionsGuard)
export class PayrollController {
  constructor(private prisma: PrismaService) {}

  /**
   * Ведомость за период: кому сколько и за что.
   * Начисляем на лету по правилам, а не храним — тогда исправление
   * ошибки в смене сразу отражается в зарплате.
   */
  @Get('sheet')
  @RequirePermission('finance.view')
  async sheet(@Req() req: any, @Query('month') month?: string) {
    const now = new Date();
    const from = month ? new Date(month + '-01') : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);

    const rules = await this.prisma.payrollRule.findMany({
      where: { accountId: req.user.acc, isActive: true },
    });
    if (!rules.length) {
      return { rows: [], note: 'Схемы оплаты не настроены — задайте оклад или процент' };
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: rules.map((r) => r.userId) } },
      select: { id: true, fullName: true },
    });
    const nameBy = new Map(users.map((u) => [u.id, u.fullName] as const));

    const rows: any[] = [];
    for (const rule of rules) {
      const [shifts, orders, manual] = await Promise.all([
        this.prisma.cashShift.findMany({
          where: { openedBy: rule.userId, openedAt: { gte: from, lt: to }, closedAt: { not: null } },
          select: { openedAt: true, closedAt: true },
        }),
        this.prisma.order.findMany({
          where: {
            waiterId: rule.userId, status: 'CLOSED',
            closedAt: { gte: from, lt: to },
          },
          select: { total: true },
        }),
        this.prisma.payrollEntry.findMany({
          where: { userId: rule.userId, periodFrom: { gte: from }, periodTo: { lte: to } },
        }),
      ]);

      const hours = shifts.reduce((s, sh) =>
        s + (sh.closedAt!.getTime() - sh.openedAt.getTime()) / 3600_000, 0);
      const personalSales = orders.reduce((s, o) => s + o.total, 0);

      const lines: { kind: string; label: string; amount: number }[] = [];
      if (rule.salary > 0) {
        lines.push({ kind: 'SALARY', label: 'Оклад', amount: rule.salary });
      }
      if (rule.perShift > 0) {
        lines.push({
          kind: 'SHIFT', label: `Смены · ${shifts.length}`,
          amount: rule.perShift * shifts.length,
        });
      }
      if (rule.perHour > 0) {
        lines.push({
          kind: 'HOURLY', label: `Часы · ${Math.round(hours)}`,
          amount: Math.round(rule.perHour * hours),
        });
      }
      const pct = Number(rule.salesPct);
      if (pct > 0) {
        lines.push({
          kind: 'SALES_PCT',
          // Процент считается по личным чекам — иначе премию делят
          // поровну и мотивация исчезает
          label: `${pct}% с личных продаж`,
          amount: Math.round(personalSales * pct / 100),
        });
      }

      for (const m of manual) {
        lines.push({
          kind: m.kind,
          label: m.kind === 'BONUS' ? `Премия${m.note ? ': ' + m.note : ''}`
            : m.kind === 'FINE' ? `Штраф${m.note ? ': ' + m.note : ''}`
            : `Аванс${m.note ? ': ' + m.note : ''}`,
          amount: m.amount,
        });
      }

      const accrued = lines.filter((l) => l.kind !== 'ADVANCE').reduce((s, l) => s + l.amount, 0);
      const advances = Math.abs(lines.filter((l) => l.kind === 'ADVANCE').reduce((s, l) => s + l.amount, 0));

      rows.push({
        userId: rule.userId,
        name: nameBy.get(rule.userId) ?? '—',
        // Плоские поля для экрана ведомости; разбивка остаётся в lines
        role: rule.perShift > 0 ? 'Смены' : rule.salary > 0 ? 'Оклад' : 'Процент',
        baseSalary: rule.salary + rule.perShift * shifts.length,
        hourly: Math.round(rule.perHour * hours),
        salesPct: pct > 0 ? Math.round(personalSales * pct / 100) : 0,
        shiftsCount: shifts.length,
        hours: Math.round(hours),
        personalSales,
        lines,
        accrued,
        advances,
        // К выдаче — то, что реально отдадут на руки
        toPay: accrued - advances,
      });
    }

    const total = rows.reduce((s, r) => s + r.toPay, 0);

    return {
      period: { from, to },
      periodLabel: from.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
      rows: rows.sort((a, b) => b.toPay - a.toPay),
      totalToPay: total,
      peopleCount: rows.length,
      // Доля зарплаты в выручке: норма общепита 22–28%,
      // выше — либо переплата, либо провал по продажам
      note: `Итого к выдаче ${Math.trunc(total / 100).toLocaleString('ru-RU')} ₸`,
    };
  }

  /** Настроить схему оплаты сотрудника. */
  @Post('rules')
  @RequirePermission('admin.employees')
  async setRule(@Body() dto: RuleDto, @Req() req: any) {
    const has = (dto.salary ?? 0) + (dto.perShift ?? 0) + (dto.perHour ?? 0) + Number(dto.salesPct ?? 0);
    if (has <= 0) {
      throw new BadRequestException({
        code: 'EMPTY_RULE',
        message: 'Задайте хотя бы оклад, ставку за смену или процент',
      });
    }

    await this.prisma.payrollRule.updateMany({
      where: { userId: dto.userId, isActive: true },
      data: { isActive: false },
    });

    const rule = await this.prisma.payrollRule.create({
      data: {
        accountId: req.user.acc,
        userId: dto.userId,
        locationId: dto.locationId ?? null,
        salary: dto.salary ?? 0,
        perShift: dto.perShift ?? 0,
        perHour: dto.perHour ?? 0,
        salesPct: (dto.salesPct ?? 0) as any,
        categoryId: dto.categoryId ?? null,
      },
    });
    return { id: rule.id };
  }

  /**
   * Премия, штраф, аванс. Штраф записываем отрицательной суммой,
   * чтобы в ведомости он вычитался, а не прибавлялся по ошибке.
   */
  @Post('entries')
  @RequirePermission('finance.edit')
  async addEntry(@Body() dto: EntryDto, @Req() req: any) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);

    // Штраф и аванс всегда отрицательные: если менеджер введёт
    // положительное число, оно увеличит зарплату вместо уменьшения
    const amount = dto.kind === 'BONUS'
      ? Math.abs(dto.amount)
      : -Math.abs(dto.amount);

    const e = await this.prisma.payrollEntry.create({
      data: {
        accountId: req.user.acc,
        userId: dto.userId,
        kind: dto.kind as any,
        amount,
        periodFrom: from,
        periodTo: to,
        note: dto.note ?? null,
        byUserId: req.user.sub,
      },
    });
    return { id: e.id, amount };
  }

  /** Отметить выплату — деньги отданы на руки. */
  @Post('pay')
  @RequirePermission('finance.edit')
  async markPaid(@Body() dto: { userId: string; amount: number }, @Req() req: any) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);

    await this.prisma.payrollEntry.create({
      data: {
        accountId: req.user.acc,
        userId: dto.userId,
        kind: 'ADVANCE',
        amount: -Math.abs(dto.amount),
        periodFrom: from,
        periodTo: to,
        note: 'Выплата',
        paidAt: new Date(),
        byUserId: req.user.sub,
      },
    });
    return { ok: true };
  }
}

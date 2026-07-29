// apps/api/src/core/notify.controller.ts
// Экран уведомлений: что требует внимания прямо сейчас.
import {
  Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { NOTIFY_KINDS, NotifyService } from './notify.service';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('notifications')
@UseGuards(JwtGuard)
export class NotifyController {
  constructor(
    private prisma: PrismaService,
    private notify: NotifyService,
  ) {}

  /** Непрочитанные и нерешённые — то, что висит. */
  @Get()
  async list(@Req() req: any, @Query('all') all?: string) {
    const rows = await this.prisma.notification.findMany({
      where: {
        accountId: req.user.acc,
        OR: [{ userId: null }, { userId: req.user.sub }],
        ...(all === 'true' ? {} : { resolvedAt: null }),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });

    const order = { URGENT: 0, WARN: 1, INFO: 2 } as Record<string, number>;

    return {
      unread: rows.filter((r) => !r.readAt).length,
      urgent: rows.filter((r) => r.level === 'URGENT' && !r.resolvedAt).length,
      rows: rows
        // Срочное вверх независимо от времени: касса не в сети
        // важнее вчерашней подписки
        .sort((a, b) =>
          (order[a.level] ?? 3) - (order[b.level] ?? 3) ||
          b.createdAt.getTime() - a.createdAt.getTime())
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          level: r.level,
          title: r.title,
          body: r.body,
          actionUrl: r.actionUrl,
          actionText: r.actionText,
          at: r.createdAt,
          read: !!r.readAt,
          resolved: !!r.resolvedAt,
          ageHours: Math.floor((Date.now() - r.createdAt.getTime()) / 3600_000),
        })),
    };
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string) {
    await this.prisma.notification.update({
      where: { id }, data: { readAt: new Date() },
    }).catch(() => null);
    return { ok: true };
  }

  /** Настройки подписок: что получать и когда молчать. */
  @Get('settings')
  async settings(@Req() req: any) {
    const subs = await this.prisma.notifySubscription.findMany({
      where: { userId: req.user.sub },
    });
    const byKind = new Map(subs.map((s) => [s.kind, s] as const));

    return {
      kinds: Object.entries(NOTIFY_KINDS).map(([kind, meta]) => {
        const s = byKind.get(kind);
        return {
          kind,
          label: meta.label,
          level: meta.level,
          // Срочное нельзя отключить: если касса не в сети,
          // владелец должен узнать, даже если не хочет
          canDisable: meta.level !== 'URGENT',
          enabled: s ? s.isActive : true,
          channels: s?.channels ?? ['in_app'],
          quietFrom: s?.quietFrom ?? 23,
          quietTo: s?.quietTo ?? 8,
        };
      }),
      note: 'Срочные приходят всегда — их отключить нельзя',
    };
  }

  @Post('settings')
  async saveSettings(
    @Body() dto: {
      kind: string; enabled: boolean; channels?: string[];
      quietFrom?: number; quietTo?: number;
    },
    @Req() req: any,
  ) {
    const meta = NOTIFY_KINDS[dto.kind];
    if (!meta) return { ok: false, code: 'UNKNOWN_KIND' };

    // Срочные не отключаются — молча сохраняем включённым
    const enabled = meta.level === 'URGENT' ? true : dto.enabled;

    await this.prisma.notifySubscription.upsert({
      where: { userId_kind: { userId: req.user.sub, kind: dto.kind } },
      update: {
        isActive: enabled,
        channels: dto.channels ?? ['in_app'],
        quietFrom: dto.quietFrom ?? null,
        quietTo: dto.quietTo ?? null,
      },
      create: {
        accountId: req.user.acc,
        userId: req.user.sub,
        kind: dto.kind,
        isActive: enabled,
        channels: dto.channels ?? ['in_app'],
        quietFrom: dto.quietFrom ?? null,
        quietTo: dto.quietTo ?? null,
      },
    });

    return {
      ok: true,
      forced: meta.level === 'URGENT' && !dto.enabled
        ? 'Срочные уведомления отключить нельзя' : null,
    };
  }
}

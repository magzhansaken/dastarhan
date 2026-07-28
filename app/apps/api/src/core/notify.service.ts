// apps/api/src/core/notify.service.ts
// Уведомления, которые не хочется отключить.
//
// Главная ошибка конкурентов: слать всё подряд. Через неделю
// владелец отключает уведомления целиком и пропускает важное.
//
// Наше правило: если человеку не надо ничего делать — это запись
// в журнале, а не уведомление.
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Каталог событий. Уровень определяет, будить ли человека. */
export const NOTIFY_KINDS: Record<string, {
  label: string;
  level: 'INFO' | 'WARN' | 'URGENT';
  /** Через сколько часов можно повторить, если не решили */
  repeatAfterH: number;
  permission: string;
}> = {
  shift_not_closed: {
    label: 'Смена не закрыта',
    level: 'URGENT', repeatAfterH: 6, permission: 'cash.shift.close',
  },
  terminal_offline: {
    label: 'Касса не в сети',
    level: 'URGENT', repeatAfterH: 2, permission: 'reports.view',
  },
  fiscal_stuck: {
    label: 'Чеки не уходят в ОФД',
    level: 'URGENT', repeatAfterH: 4, permission: 'admin.settings',
  },
  expired_products: {
    label: 'Просроченные продукты',
    level: 'URGENT', repeatAfterH: 12, permission: 'stock.supply',
  },
  low_stock: {
    label: 'Заканчиваются продукты',
    level: 'WARN', repeatAfterH: 24, permission: 'stock.supply',
  },
  revenue_drop: {
    label: 'Выручка ниже обычной',
    level: 'WARN', repeatAfterH: 24, permission: 'reports.view',
  },
  many_removals: {
    label: 'Много удалений позиций',
    level: 'WARN', repeatAfterH: 24, permission: 'admin.employees',
  },
  banquet_unpaid: {
    label: 'Банкет без предоплаты',
    level: 'WARN', repeatAfterH: 24, permission: 'order.create',
  },
  supply_overdue: {
    label: 'Поставка просрочена',
    level: 'WARN', repeatAfterH: 12, permission: 'stock.supply',
  },
  subscription_ending: {
    label: 'Подписка заканчивается',
    level: 'INFO', repeatAfterH: 48, permission: 'admin.billing',
  },
};

@Injectable()
export class NotifyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Создать уведомление с защитой от повторов.
   *
   * Ключ дедупликации обязателен: «конина кончается» не должна
   * приходить каждые пять минут, пока её не закажут.
   */
  async push(input: {
    accountId: string;
    kind: string;
    title: string;
    body?: string;
    dedupKey: string;
    userId?: string;
    locationId?: string;
    actionUrl?: string;
    actionText?: string;
  }) {
    const meta = NOTIFY_KINDS[input.kind];
    if (!meta) return null;

    // Не повторяем, пока проблема не решена и не прошёл интервал
    const recent = await this.prisma.notification.findFirst({
      where: {
        dedupKey: input.dedupKey,
        resolvedAt: null,
        createdAt: { gte: new Date(Date.now() - meta.repeatAfterH * 3600_000) },
      },
    });
    if (recent) return recent;

    return this.prisma.notification.create({
      data: {
        accountId: input.accountId,
        userId: input.userId ?? null,
        locationId: input.locationId ?? null,
        kind: input.kind,
        level: meta.level as any,
        title: input.title,
        body: input.body ?? null,
        actionUrl: input.actionUrl ?? null,
        actionText: input.actionText ?? null,
        dedupKey: input.dedupKey,
      },
    });
  }

  /**
   * Пометить решённым. Уведомление гаснет само, когда причина
   * исчезла — владельцу не нужно закрывать его вручную.
   */
  async resolve(dedupKey: string) {
    await this.prisma.notification.updateMany({
      where: { dedupKey, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  /**
   * Можно ли беспокоить сейчас.
   * Срочное проходит всегда, остальное ждёт утра.
   */
  static canDisturb(
    level: string,
    now: Date,
    quietFrom?: number | null,
    quietTo?: number | null,
  ): boolean {
    if (level === 'URGENT') return true;
    if (quietFrom == null || quietTo == null) return true;

    const h = now.getHours();
    // Ночной интервал через полночь: с 23 до 8
    const quiet = quietFrom <= quietTo
      ? h >= quietFrom && h < quietTo
      : h >= quietFrom || h < quietTo;
    return !quiet;
  }
}

// apps/api/src/core/sync.controller.ts
// Приём офлайн-событий с касс. Идемпотентность по eventId (ULID устройства):
// повторная отправка того же события безопасна — фундамент офлайн-надёжности.
import { Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { OrderMaterializer } from './order-materializer';
import type { SyncEvent } from '../../../../packages/shared/src';

@Controller('sync')
export class SyncController {
  constructor(
    private prisma: PrismaService,
    private materializer: OrderMaterializer,
  ) {}

  @Post('events')
  async ingest(@Body() body: { events: SyncEvent[] }) {
    const results: { eventId: string; status: string }[] = [];
    for (const ev of body.events ?? []) {
      try {
        await this.prisma.eventLog.create({
          data: {
            eventId: ev.eventId,
            accountId: (ev as any).accountId ?? '',
            terminalId: ev.terminalId,
            type: ev.type,
            payload: ev.payload as object,
            createdAt: new Date(ev.createdAt),
          },
        });
        results.push({ eventId: ev.eventId, status: 'accepted' });

        // Событие сохранено — теперь превращаем его в заказ.
        // Ошибка разбора не откатывает приём: чек уже в EventLog
        // и может быть разобран повторно.
        if (ev.type === 'order.closed') {
          await this.materializer.materialize({
            terminalId: ev.terminalId,
            payload: ev.payload,
          });
        }
      } catch (e: any) {
        // P2002 = уже принимали это событие → идемпотентный OK
        if (e?.code === 'P2002') results.push({ eventId: ev.eventId, status: 'duplicate' });
        else results.push({ eventId: ev.eventId, status: 'error' });
      }
    }
    return { results };
  }

  /**
   * Разбор чеков, принятых до появления обработчика или упавших при разборе.
   * Идемпотентно: уже проведённые заказы пропускаются.
   */
  @Post('reprocess')
  async reprocess() {
    const events = await this.prisma.eventLog.findMany({
      where: { type: 'order.closed' },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    let created = 0, skipped = 0, errors = 0;
    for (const e of events) {
      const r = await this.materializer.materialize({
        terminalId: e.terminalId,
        payload: e.payload as any,
      });
      if (r === 'created') created++;
      else if (r === 'skipped') skipped++;
      else errors++;
    }
    return { total: events.length, created, skipped, errors };
  }
}

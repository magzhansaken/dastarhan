// apps/api/src/core/sync.controller.ts
// Приём офлайн-событий с касс. Идемпотентность по eventId (ULID устройства):
// повторная отправка того же события безопасна — фундамент офлайн-надёжности.
import { Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { SyncEvent } from '@dastarhan/shared';

@Controller('sync')
export class SyncController {
  constructor(private prisma: PrismaService) {}

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
      } catch (e: any) {
        // P2002 = уже принимали это событие → идемпотентный OK
        if (e?.code === 'P2002') results.push({ eventId: ev.eventId, status: 'duplicate' });
        else results.push({ eventId: ev.eventId, status: 'error' });
      }
    }
    return { results };
  }
}

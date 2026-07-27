// apps/api/src/verticals/verticals.controller.ts
// Магазин (весовые штрихкоды) и бильярд/караоке (тарификация времени).
// Разбор кода и расчёт минут уже в verticals.logic и покрыты тестами.
import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { parseWeightBarcode, tariffAt } from './verticals.logic';
import type { Tariff } from './verticals.logic';

@Controller('verticals')
@UseGuards(JwtGuard)
export class VerticalsController {
  constructor(private prisma: PrismaService) {}

  /**
   * Разбор штрихкода. Весовой код (префикс 22/23) содержит вес внутри —
   * кассир не вводит граммы руками, а значит не ошибается на кассе.
   */
  @Get('barcode')
  async barcode(@Query('code') code: string) {
    if (!code) throw new BadRequestException({ code: 'NO_BARCODE' });

    const weighted = parseWeightBarcode(code);
    if (weighted) {
      const product = await this.prisma.product.findFirst({
        where: { barcodes: { some: { value: String((weighted as any).plu) } } },
        select: { id: true, name: true, basePrice: true, unit: true },
      }).catch(() => null);

      return {
        kind: 'WEIGHTED',
        plu: (weighted as any).plu,
        weightKg: (weighted as any).weight ?? (weighted as any).qty ?? null,
        product: product
          ? { productId: product.id, name: product.name, price: product.basePrice }
          : null,
      };
    }

    const product = await this.prisma.product.findFirst({
      where: { barcodes: { some: { value: code } } },
      select: { id: true, name: true, basePrice: true, unit: true, isWeighted: true },
    });

    if (!product) return { kind: 'UNKNOWN', code };

    return {
      kind: 'PIECE',
      productId: product.id,
      name: product.name,
      price: product.basePrice,
      unit: product.unit,
    };
  }

  /**
   * Активные сессии тарификации: бильярдные столы, караоке-кабинки.
   * Показываем сколько минут идёт и текущую сумму — администратор
   * должен видеть это на карте зала, а не считать в уме.
   */
  @Get('sessions')
  async sessions(@Query('locationId') locationId: string) {
    const resources = await this.prisma.timedResource.findMany({
      where: { locationId, isActive: true },
      orderBy: { name: 'asc' },
    });

    const sessions = await this.prisma.timedSession.findMany({
      where: {
        resourceId: { in: resources.map((r) => r.id) },
        finishedAt: null,
      },
    });

    const byResource = new Map<string, (typeof sessions)[number]>(
      sessions.map((s) => [s.resourceId, s]),
    );
    const now = new Date();

    return resources.map((r) => {
      const s = byResource.get(r.id);
      if (!s) return { resourceId: r.id, name: r.name, busy: false };

      const minutes = Math.floor((now.getTime() - s.startedAt.getTime()) / 60000);
      // Тариф зависит от дня недели и времени суток: вечер дороже дня,
      // переключение происходит само, в том числе через полночь
      // JS getDay(): 0=воскресенье. tariffAt ждёт 0=понедельник —
      // без конвертации все тарифные окна сдвинулись бы на день
      const dow = (now.getDay() + 6) % 7;
      // Prisma отдаёт Json, который может быть null — приводим через unknown
      const tariffs = (r.tariffs as unknown as Tariff[] | null) ?? [];
      const tariff = tariffAt(tariffs, dow, now.getHours() * 60 + now.getMinutes());
      const rate = tariff ? (tariff as any).pricePerHour ?? (tariff as any).price ?? null : null;

      return {
        resourceId: r.id,
        name: r.name,
        busy: true,
        sessionId: s.id,
        startedAt: s.startedAt,
        minutes,
        status: s.status,
        currentRate: rate,
        // Приблизительная сумма: точную посчитает billSession при закрытии,
        // с учётом пауз и минимального времени
        approxAmount: rate != null ? Math.round((minutes / 60) * Number(rate)) : null,
      };
    });
  }
}

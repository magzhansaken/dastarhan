// apps/api/src/menu/promo.controller.ts
// Акции: комбо, счастливые часы, N+1, скидка на категорию.
//
// Ключевое отличие: акции применяются автоматически, а не по кнопке.
// Кассир не должен помнить, что с 15 до 17 кофе дешевле — иначе
// половина гостей не получит обещанного, а половина получит дважды.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class PromoDto {
  @IsString() @Length(3, 80) name!: string;
  @IsIn(['COMBO', 'HAPPY_HOURS', 'N_PLUS_ONE', 'CATEGORY_OFF', 'SECOND_HALF'])
  type!: string;
  config!: any;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
}

@Controller('promo')
@UseGuards(JwtGuard, PermissionsGuard)
export class PromoController {
  constructor(private prisma: PrismaService) {}

  /**
   * Подобрать акции к текущему заказу.
   * Касса вызывает при каждом изменении чека и показывает,
   * что гость получит — до оплаты, а не после.
   */
  @Post('match')
  @RequirePermission('order.create')
  async match(
    @Body() dto: {
      items: { productId: string; qty: number; unitPrice: number; categoryId?: string }[];
      total: number;
      at?: string;
    },
    @Req() req: any,
  ) {
    const now = dto.at ? new Date(dto.at) : new Date();

    const promos = await this.prisma.promo.findMany({
      where: {
        accountId: req.user.acc,
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        ],
      },
    });

    const applied: {
      promoId: string; name: string; type: string;
      discount: number; explain: string;
    }[] = [];
    for (const p of promos) {
      const cfg = p.config as any;
      const res = this.apply(p.type, cfg, dto.items, dto.total, now);
      if (res.discount > 0) {
        applied.push({
          promoId: p.id,
          name: p.name,
          type: p.type,
          discount: res.discount,
          explain: res.explain,
        });
      }
    }

    // Не суммируем все акции: гость получает лучшую.
    // Иначе комбо плюс счастливые часы плюс вторая за полцены
    // дадут блюдо бесплатно, и это заметят не сразу
    applied.sort((a, b) => b.discount - a.discount);
    const best = applied[0] ?? null;

    return {
      matched: applied.length,
      // Показываем все найденные, но применяем одну — кассир видит,
      // что ещё было доступно, и может предложить гостю выбрать
      all: applied,
      best,
      finalTotal: dto.total - (best?.discount ?? 0),
    };
  }

  private apply(
    type: string,
    cfg: any,
    items: { productId: string; qty: number; unitPrice: number; categoryId?: string }[],
    total: number,
    now: Date,
  ): { discount: number; explain: string } {
    switch (type) {
      case 'HAPPY_HOURS': {
        // Счастливые часы: скидка в тихое время, чтобы заполнить зал.
        // Проверяем и час, и день недели — в выходные скидка не нужна
        const h = now.getHours();
        const dow = (now.getDay() + 6) % 7;
        const fromH = cfg.fromHour ?? 15, toH = cfg.toHour ?? 17;
        const days: number[] = cfg.days ?? [0, 1, 2, 3, 4];
        if (h < fromH || h >= toH || !days.includes(dow)) {
          return { discount: 0, explain: '' };
        }
        const scope = cfg.categoryId
          ? items.filter((i) => i.categoryId === cfg.categoryId)
          : items;
        const sum = scope.reduce((s, i) => s + i.qty * i.unitPrice, 0);
        const d = Math.round(sum * (cfg.percent ?? 20) / 100);
        return {
          discount: d,
          explain: `Счастливые часы ${fromH}:00–${toH}:00 · −${cfg.percent ?? 20}%`,
        };
      }

      case 'N_PLUS_ONE': {
        // Три по цене двух: считаем по каждой позиции отдельно,
        // а не по общему количеству — иначе кофе и чай сложатся
        const n = cfg.n ?? 3, pay = cfg.pay ?? 2;
        let d = 0;
        const names: string[] = [];
        for (const i of items) {
          if (cfg.productIds?.length && !cfg.productIds.includes(i.productId)) continue;
          const sets = Math.floor(i.qty / n);
          if (sets > 0) {
            d += sets * (n - pay) * i.unitPrice;
            names.push(`×${sets}`);
          }
        }
        return d > 0
          ? { discount: d, explain: `${n} по цене ${pay} ${names.join(', ')}` }
          : { discount: 0, explain: '' };
      }

      case 'SECOND_HALF': {
        // Вторая за полцены: скидка на более дешёвую позицию,
        // иначе гость возьмёт дорогое и дешёвое, а платить будет
        // половину за дорогое — заведение в минусе
        const scope = items.filter(
          (i) => !cfg.productIds?.length || cfg.productIds.includes(i.productId),
        );
        const flat: number[] = [];
        for (const i of scope) for (let k = 0; k < i.qty; k++) flat.push(i.unitPrice);
        if (flat.length < 2) return { discount: 0, explain: '' };
        flat.sort((a, b) => b - a);
        let d = 0;
        for (let k = 1; k < flat.length; k += 2) {
          d += Math.round(flat[k] * (cfg.percent ?? 50) / 100);
        }
        return { discount: d, explain: `Вторая за полцены · ${Math.floor(flat.length / 2)} шт` };
      }

      case 'COMBO': {
        // Комбо: набор целиком дешевле, чем по отдельности.
        // Требуем все позиции — иначе гость возьмёт только суп
        // и получит скидку за обед
        const need: { productId: string; qty: number }[] = cfg.items ?? [];
        if (!need.length) return { discount: 0, explain: '' };

        let sets = Infinity;
        for (const nItem of need) {
          const have = items
            .filter((i) => i.productId === nItem.productId)
            .reduce((s, i) => s + i.qty, 0);
          sets = Math.min(sets, Math.floor(have / nItem.qty));
        }
        if (!sets || sets === Infinity) return { discount: 0, explain: '' };

        const full = need.reduce((s, nItem) => {
          const it = items.find((i) => i.productId === nItem.productId);
          return s + (it?.unitPrice ?? 0) * nItem.qty;
        }, 0);
        const comboPrice = cfg.price ?? full;
        const d = Math.max(0, (full - comboPrice) * sets);
        return d > 0
          ? { discount: d, explain: `Комбо ×${sets}` }
          : { discount: 0, explain: '' };
      }

      case 'CATEGORY_OFF': {
        const scope = items.filter((i) => i.categoryId === cfg.categoryId);
        const sum = scope.reduce((s, i) => s + i.qty * i.unitPrice, 0);
        if (sum < (cfg.minSum ?? 0)) return { discount: 0, explain: '' };
        const d = Math.round(sum * (cfg.percent ?? 10) / 100);
        return { discount: d, explain: `−${cfg.percent ?? 10}% на категорию` };
      }

      default:
        return { discount: 0, explain: '' };
    }
  }

  @Get()
  @RequirePermission('crm.bonus.adjust')
  async list(@Req() req: any) {
    const rows = await this.prisma.promo.findMany({
      where: { accountId: req.user.acc },
      orderBy: { validFrom: 'desc' },
    });

    // Эффективность: сколько раз сработала и на какую сумму.
    // Акция без применений — либо про неё не знают, либо условия
    // невыполнимы. И то и другое надо чинить
    const out: any[] = [];
    for (const p of rows) {
      const uses = await this.prisma.promoUse.count({ where: { promoId: p.id } })
        .catch(() => 0);
      out.push({
        id: p.id, name: p.name, type: p.type,
        isActive: p.isActive,
        validFrom: p.validFrom, validTo: p.validTo,
        usesCount: uses,
        warning: uses === 0 && p.isActive
          ? 'Ни разу не сработала — проверьте условия'
          : null,
      });
    }
    return out;
  }

  @Post()
  @RequirePermission('crm.bonus.adjust')
  async create(@Body() dto: PromoDto, @Req() req: any) {
    const p = await this.prisma.promo.create({
      data: {
        accountId: req.user.acc,
        name: dto.name.trim(),
        type: dto.type as any,
        config: dto.config,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
      },
    });
    return { id: p.id, name: p.name };
  }
}

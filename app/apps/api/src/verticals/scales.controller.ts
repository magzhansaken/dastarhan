// apps/api/src/verticals/scales.controller.ts
// Весовой товар и штрихкоды для магазинов и кулинарий.
//
// Весы печатают этикетку со штрихкодом, в который зашит вес.
// Кассир сканирует — цена считается сама. Без этого продавец
// вбивает вес руками и ошибается на каждой десятой позиции.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class BarcodeDto {
  @IsString() productId!: string;
  @IsString() @Length(6, 14) value!: string;
  @IsOptional() @IsString() unit?: string;
}

@Controller('scales')
@UseGuards(JwtGuard, PermissionsGuard)
export class ScalesController {
  constructor(private prisma: PrismaService) {}

  /**
   * Разбор штрихкода со сканера.
   *
   * Три случая, и их надо различать:
   *  · обычный EAN-13 — товар штучный, ищем по коду
   *  · весовой (префикс 20-29) — внутри код товара и вес
   *  · ценовой (префикс 21) — внутри цена, а не вес
   *
   * Ошибка тут стоит дорого: продавец пробьёт 2 кг вместо 200 г
   * и не заметит, пока не сойдётся инвентаризация.
   */
  @Get('scan')
  @RequirePermission('order.create')
  async scan(@Query('code') code: string, @Req() req: any) {
    const raw = (code ?? '').trim();
    if (!raw) throw new BadRequestException({ code: 'EMPTY_CODE' });

    // Весовой штрихкод: 13 цифр, первые две — 20..29
    const isWeighted = /^\d{13}$/.test(raw) && Number(raw.slice(0, 2)) >= 20
      && Number(raw.slice(0, 2)) <= 29;

    if (!isWeighted) {
      const found = await this.prisma.barcode.findFirst({
        where: { value: raw },
        include: { product: { select: { id: true, name: true, basePrice: true, unit: true } } },
      });
      if (!found) {
        return {
          found: false,
          code: raw,
          // Подсказка вместо тупика: продавец может привязать код
          // прямо сейчас, а не идти в бэк-офис
          hint: 'Код не найден — привяжите его к товару',
        };
      }
      return {
        found: true,
        kind: 'plain',
        productId: found.product.id,
        name: found.product.name,
        qty: 1,
        price: found.product.basePrice,
        total: found.product.basePrice,
      };
    }

    // Структура: PP CCCCC WWWWW K
    //   PP    — префикс 20..29
    //   CCCCC — внутренний код товара
    //   WWWWW — вес в граммах или цена в тиынах
    //   K     — контрольная цифра
    const prefix = raw.slice(0, 2);
    const innerCode = raw.slice(2, 7);
    const payload = Number(raw.slice(7, 12));

    const found = await this.prisma.barcode.findFirst({
      where: { value: innerCode },
      include: { product: { select: { id: true, name: true, basePrice: true, unit: true } } },
    });
    if (!found) {
      return {
        found: false,
        code: raw,
        innerCode,
        hint: `Весовой товар с кодом ${innerCode} не найден`,
      };
    }

    // Префикс 21 по отраслевой практике означает цену, а не вес.
    // Путать нельзя: 500 в одном случае это полкило, в другом 5 ₸
    const isPrice = prefix === '21';
    const p = found.product;

    if (isPrice) {
      // Весы пишут цену в тенге с двумя знаками: 01400 = 14,00 ₸.
      // Умножаем на 100, получая тиыны. Множитель 10 дал бы
      // цену вдесятеро меньше — и магазин торговал бы в убыток
      const total = payload * 100;
      const qty = p.basePrice > 0 ? +(total / p.basePrice).toFixed(3) : 1;
      return {
        found: true, kind: 'weighted_price',
        productId: p.id, name: p.name, unit: p.unit,
        qty, price: p.basePrice, total,
      };
    }

    const qty = payload / 1000;     // граммы → килограммы
    return {
      found: true, kind: 'weighted',
      productId: p.id, name: p.name, unit: p.unit,
      qty: +qty.toFixed(3),
      price: p.basePrice,
      total: Math.round(p.basePrice * qty),
    };
  }

  /** Привязать штрихкод к товару прямо с кассы. */
  @Post('barcode')
  @RequirePermission('menu.edit')
  async addBarcode(@Body() dto: BarcodeDto) {
    const exists = await this.prisma.barcode.findFirst({ where: { value: dto.value } });
    if (exists) {
      throw new BadRequestException({
        code: 'BARCODE_TAKEN',
        message: 'Этот код уже привязан к другому товару',
      });
    }
    const b = await this.prisma.barcode.create({
      data: { productId: dto.productId, value: dto.value.trim() },
    });
    return { ok: true, id: b.id };
  }

  /**
   * Данные для выгрузки в весы. Магазин загружает справочник
   * в весы через утилиту производителя — нужен файл в их формате.
   */
  @Get('export')
  @RequirePermission('menu.edit')
  async exportForScales(@Req() req: any) {
    const products = await this.prisma.product.findMany({
      where: {
        accountId: req.user.acc,
        isDeleted: false,
        unit: { in: ['KG', 'L'] },
        type: { in: ['DISH', 'GOODS'] },
      },
      include: { barcodes: { select: { value: true } } },
      orderBy: { name: 'asc' },
    });

    return {
      note: 'Загрузите справочник в весы утилитой производителя',
      rows: products.map((p, i) => {
        // Внутренний код: пять цифр, стабильный между выгрузками.
        // Если он поменяется, весы напечатают этикетки с чужим товаром
        const inner = p.barcodes.find((b) => /^\d{5}$/.test(b.value))?.value
          ?? String(20000 + i).padStart(5, '0');
        return {
          plu: inner,
          name: p.name,
          // Весы обрезают длинные названия — предупреждаем заранее
          shortName: p.name.slice(0, 28),
          price: p.basePrice,
          unit: p.unit,
          truncated: p.name.length > 28,
        };
      }),
    };
  }
}

// apps/api/src/menu/modifiers.controller.ts
// Модификаторы блюд: «без лука», «двойной сыр», выбор гарнира.
//
// Ключевое отличие от конкурентов: мы проверяем правила выбора
// на сервере, а не только рисуем звёздочку «обязательно».
// Кассир не должен отправить на кухню бизнес-ланч без супа
// и узнать об этом от повара.
import {
  Body, Controller, Get, Post, Query, Req, UseGuards,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../core/prisma.service';
import { JwtGuard } from '../auth/jwt.guard';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

class GroupDto {
  @IsString() @Length(2, 60) name!: string;
  @IsOptional() @IsString() nameKk?: string;
  /** Сколько выбрать минимум: 0 — необязательно, 1 — обязательно */
  @IsInt() @Min(0) minSelect!: number;
  /** Максимум: 1 — переключатель, больше — галочки */
  @IsInt() @Min(1) maxSelect!: number;
  @IsArray() options!: {
    name: string; nameKk?: string; priceDelta: number;
    componentId?: string; componentQty?: number;
  }[];
}

@Controller('modifiers')
@UseGuards(JwtGuard, PermissionsGuard)
export class ModifiersController {
  constructor(private prisma: PrismaService) {}

  /** Группы модификаторов блюда — касса запрашивает при добавлении позиции. */
  @Get('for-product')
  @RequirePermission('order.create')
  async forProduct(@Query('productId') productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      // Product связан с группами через промежуточную таблицу
      include: {
        modifierGroups: {
          include: { group: { include: { options: { orderBy: { priceDelta: 'asc' } } } } },
        },
      },
    }).catch(() => null);

    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });

    // Разворачиваем промежуточную таблицу в сами группы
    const groups = ((product as any).modifierGroups ?? []).map((pg: any) => pg.group).filter(Boolean);

    return groups
      .filter((g: any) => !g.isDeleted)
      .map((g: any) => ({
        groupId: g.id,
        name: g.name,
        nameKk: g.nameKk,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        // Тип виджета выводим из правил, а не храним отдельно:
        // одно поле меньше рассинхронизируется
        widget: g.maxSelect === 1 ? 'radio' : 'checkbox',
        required: g.minSelect > 0,
        // Подсказка кассиру словами: «выберите гарнир» понятнее,
        // чем звёздочка и цифры 1..1
        hint: this.hintFor(g.minSelect, g.maxSelect),
        options: g.options.map((o: any) => ({
          optionId: o.id,
          name: o.name,
          nameKk: o.nameKk,
          priceDelta: o.priceDelta,
          // Бесплатные опции показываем без ценника: «без лука · 0 ₸»
          // выглядит как ошибка
          free: o.priceDelta === 0,
        })),
      }));
  }

  /**
   * Проверка выбора перед добавлением в чек.
   * Возвращает итоговую цену и то, что не так — до отправки на кухню.
   */
  @Post('validate')
  @RequirePermission('order.create')
  async validate(
    @Body() dto: { productId: string; selected: { groupId: string; optionIds: string[] }[] },
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { modifierGroups: { include: { group: { include: { options: true } } } } },
    }).catch(() => null);
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });

    const groups = ((product as any).modifierGroups ?? [])
      .map((pg: any) => pg.group).filter((g: any) => g && !g.isDeleted);
    const selBy = new Map(dto.selected.map((s) => [s.groupId, s.optionIds] as const));

    const errors: string[] = [];
    let priceDelta = 0;
    const chosen: { groupName: string; optionName: string; priceDelta: number }[] = [];

    for (const g of groups) {
      const picked = selBy.get(g.id) ?? [];

      if (picked.length < g.minSelect) {
        errors.push(
          g.minSelect === 1
            ? `Выберите ${g.name.toLowerCase()}`
            : `В группе «${g.name}» нужно выбрать минимум ${g.minSelect}`,
        );
        continue;
      }
      if (picked.length > g.maxSelect) {
        errors.push(`В группе «${g.name}» можно выбрать не больше ${g.maxSelect}`);
        continue;
      }

      for (const optId of picked) {
        const opt = g.options.find((o: any) => o.id === optId);
        if (!opt) {
          errors.push(`Опция не найдена в группе «${g.name}»`);
          continue;
        }
        priceDelta += opt.priceDelta;
        chosen.push({ groupName: g.name, optionName: opt.name, priceDelta: opt.priceDelta });
      }
    }

    const base = product.basePrice;

    return {
      valid: errors.length === 0,
      errors,
      basePrice: base,
      priceDelta,
      finalPrice: base + priceDelta,
      chosen,
      // Строка для чека и кухни: «Плов · двойное мясо, без лука»
      label: chosen.length
        ? chosen.map((c) => c.optionName).join(', ')
        : null,
    };
  }

  /** Создать группу модификаторов. */
  @Post('groups')
  @RequirePermission('menu.edit')
  async createGroup(@Body() dto: GroupDto, @Req() req: any) {
    if (dto.maxSelect < dto.minSelect) {
      throw new BadRequestException({
        code: 'BAD_LIMITS',
        message: 'Максимум не может быть меньше минимума',
      });
    }
    if (dto.options.length < dto.minSelect) {
      throw new BadRequestException({
        code: 'NOT_ENOUGH_OPTIONS',
        message: `Нужно минимум ${dto.minSelect} опций в группе`,
      });
    }

    const g = await this.prisma.modifierGroup.create({
      data: {
        accountId: req.user.acc,
        name: dto.name.trim(),
        nameKk: dto.nameKk?.trim() || null,
        minSelect: dto.minSelect,
        maxSelect: dto.maxSelect,
        options: {
          create: dto.options.map((o) => ({
            name: o.name.trim(),
            nameKk: o.nameKk?.trim() || null,
            priceDelta: o.priceDelta,
            componentId: o.componentId ?? null,
            componentQty: (o.componentQty ?? null) as any,
          })),
        },
      },
      include: { options: true },
    });

    return { groupId: g.id, name: g.name, options: g.options.length };
  }

  /** Привязать группу к блюдам — обычно одна группа на десяток позиций. */
  @Post('groups/:id/attach')
  @RequirePermission('menu.edit')
  async attach(@Body() dto: { groupId: string; productIds: string[] }) {
    await this.prisma.modifierGroup.update({
      where: { id: dto.groupId },
      data: { products: { connect: dto.productIds.map((id) => ({ id })) } },
    });
    return { ok: true, attached: dto.productIds.length };
  }

  private hintFor(min: number, max: number): string {
    if (min === 0 && max === 1) return 'можно выбрать один';
    if (min === 0) return `можно выбрать до ${max}`;
    if (min === 1 && max === 1) return 'выберите один';
    if (min === max) return `выберите ровно ${min}`;
    return `от ${min} до ${max}`;
  }
}

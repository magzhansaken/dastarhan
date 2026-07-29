// apps/api/src/menu/modifiers.service.ts
// Валидация выбора модификаторов и расчёт цены позиции.
// Правила — объединение Poster (13.7K примеров) и QuickResto (66K):
//  - minSelect>0 → группа обязательна (нельзя продать кофе без выбора молока)
//  - maxSelect ограничивает множественный выбор
//  - isDefault → опция автодобавлена, но снимаема (QR «автоматическое добавление»)
//  - цена позиции = базовая цена точки + Σ priceDelta выбранных опций

export interface GroupDef {
  id: string; name: string; minSelect: number; maxSelect: number;
  options: { id: string; priceDelta: number; isDefault: boolean }[];
}
export interface Selection { groupId: string; optionIds: string[] }

export class ModifierValidationError extends Error {
  constructor(public code: string, public groupId: string, msg: string) {
    super(msg);
  }
}

export function applyDefaults(groups: GroupDef[]): Selection[] {
  return groups.map((g) => ({
    groupId: g.id,
    optionIds: g.options.filter((o) => o.isDefault).map((o) => o.id),
  }));
}

export function validateSelection(groups: GroupDef[], sel: Selection[]): void {
  const byId = new Map(sel.map((s) => [s.groupId, s.optionIds] as const));
  for (const g of groups) {
    const chosen = byId.get(g.id) ?? [];
    const valid = new Set(g.options.map((o) => o.id));
    for (const id of chosen)
      if (!valid.has(id))
        throw new ModifierValidationError('UNKNOWN_OPTION', g.id,
          `Опция ${id} не принадлежит группе «${g.name}»`);
    if (chosen.length < g.minSelect)
      throw new ModifierValidationError('MIN_NOT_MET', g.id,
        `«${g.name}»: выберите минимум ${g.minSelect}`);
    if (chosen.length > g.maxSelect)
      throw new ModifierValidationError('MAX_EXCEEDED', g.id,
        `«${g.name}»: не больше ${g.maxSelect}`);
  }
}

export function itemPrice(
  basePrice: number,
  groups: GroupDef[],
  sel: Selection[],
): number {
  validateSelection(groups, sel);
  let price = basePrice;
  const opts = new Map(
    groups.flatMap((g) => g.options.map((o) => [o.id, o.priceDelta] as const)),
  );
  for (const s of sel) for (const id of s.optionIds) price += opts.get(id) ?? 0;
  return price;
}

// ─────────────────────────────────────────────────────────────────
// apps/api/src/menu/menu.controller.ts — REST-каркас модуля меню
import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard, RequirePermission } from '../auth/permissions.guard';

@Controller('menu')
@UseGuards(PermissionsGuard)
export class MenuController {
  // Категории (дерево), продукты с фильтрами, техкарты с версиями,
  // модификаторы, комбо. Единый принцип API (урок Poster: открытый API
  // с 1-го дня — 368 методов у них; наши растут по этапам).
  @Get('categories') listCategories(@Query('parentId') _p?: string) {}
  @Post('categories') @RequirePermission('menu.edit') createCategory(@Body() _b: unknown) {}

  @Get('products') listProducts(
    @Query('type') _t?: string, @Query('categoryId') _c?: string,
    @Query('search') _s?: string, @Query('locationId') _l?: string,
  ) {}
  @Post('products') @RequirePermission('menu.edit') createProduct(@Body() _b: unknown) {}
  @Put('products/:id') @RequirePermission('menu.edit') updateProduct(
    @Param('id') _id: string, @Body() _b: unknown,
  ) {}

  // Техкарты: создание НОВОЙ ВЕРСИИ, не правка старой (QuickResto versionnost)
  @Get('products/:id/techcards') listTechCards(@Param('id') _id: string) {}
  @Post('products/:id/techcards') @RequirePermission('menu.edit')
  createTechCardVersion(@Param('id') _id: string, @Body() _b: unknown) {}

  // Где используется компонент («в тех.карты каких продуктов входит» — QR)
  @Get('products/:id/used-in') usedIn(@Param('id') _id: string) {}

  // Себестоимость и фудкост позиции на дату
  @Get('products/:id/cost') cost(@Param('id') _id: string, @Query('at') _at?: string) {}

  @Get('modifier-groups') listModifierGroups() {}
  @Post('modifier-groups') @RequirePermission('menu.edit') createModifierGroup(@Body() _b: unknown) {}

  @Get('combos') listCombos() {}
  @Post('combos') @RequirePermission('menu.edit') createCombo(@Body() _b: unknown) {}
}

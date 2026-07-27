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
  code: string; groupId: string;
  constructor(code: string, groupId: string, msg: string) {
    super(msg); this.code = code; this.groupId = groupId;
  }
}

export function applyDefaults(groups: GroupDef[]): Selection[] {
  return groups.map((g) => ({
    groupId: g.id,
    optionIds: g.options.filter((o) => o.isDefault).map((o) => o.id),
  }));
}

export function validateSelection(groups: GroupDef[], sel: Selection[]): void {
  const byId = new Map(sel.map((s) => [s.groupId, s.optionIds]));
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

import { unitCost, portionCost, foodCostPct, explodeWriteOff, pickVersion, CycleError } from '../../../../../packages/shared/src/menu/cost.service.ts';
import type { CostContext } from '../../../../../packages/shared/src/menu/cost.service.ts';
import { applyDefaults, validateSelection, itemPrice, ModifierValidationError } from '../modifiers.service.ts';
import type { GroupDef } from '../modifiers.service.ts';

let pass=0, fail=0;
function eq(name: string, got: any, want: any) {
  const ok = JSON.stringify(got) === JSON.stringify(want) ||
             (typeof got==='number' && Math.abs(got-want)<0.001);
  ok ? pass++ : (fail++, console.log(`  ✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
  if (ok) console.log(`  ✓ ${name}`);
}

// ═══ СЦЕНАРИЙ: капучино ═══
// Ингредиенты (тиын за грамм/мл/шт):
//   кофе-зерно 8 т/г, молоко 0.5 т/мл, сироп 1.2 т/мл, стакан 50 т/шт
// ПФ «молочная смесь»: 200мл молока + ничего → выход 180мл (потери пена)
// Блюдо «капучино» (порция 250мл): 18г зерна + 180мл смеси + 1 стакан, выход 250
const ctx: CostContext = {
  ingredientCost: new Map([['bean',8],['milk',0.5],['syrup',1.2],['cup',50]]),
  productType: new Map(),
  techCards: new Map([
    ['milkmix', { productId:'milkmix', version:1, outputQty:180,
      lines:[{componentId:'milk', bruttoQty:200}] }],
    ['cappuccino', { productId:'cappuccino', version:2, outputQty:250,
      lines:[
        {componentId:'bean', bruttoQty:18},
        {componentId:'milkmix', bruttoQty:180},
        {componentId:'cup', bruttoQty:1},
      ] }],
  ]),
};

// ПФ: 200мл × 0.5 = 100т за 180мл → 0.5556 т/мл
eq('unitCost ПФ (потери учтены)', unitCost('milkmix', ctx), 100/180);
// капучино: зерно 18×8=144 + смесь 180×0.5556=100 + стакан 50 = 294т за порцию
eq('portionCost блюда (рекурсия через ПФ)', portionCost('cappuccino', ctx), 294);
// фудкост при цене 1500т (15 тг... тут тиыны: пусть цена 1500)
eq('foodCost %', foodCostPct(294, 1500), 19.6);

// списание: 2 капучино → зерно 36г, молоко 400мл (через ПФ!), стакан 2
const wo = explodeWriteOff('cappuccino', 2, ctx);
eq('списание зерна', wo.get('bean'), 36);
eq('списание молока через ПФ', wo.get('milk'), 400);
eq('списание стаканов', wo.get('cup'), 2);

// списание с модификатором: +сироп 20мл на порцию
const wo2 = explodeWriteOff('cappuccino', 2, ctx, [{componentId:'syrup', qty:20}]);
eq('модификатор списывает склад', wo2.get('syrup'), 40);

// цикл: A→B→A должен дать ошибку, не зависание
const bad: CostContext = { ingredientCost:new Map(), productType:new Map(),
  techCards: new Map([
    ['A',{productId:'A',version:1,outputQty:1,lines:[{componentId:'B',bruttoQty:1}]}],
    ['B',{productId:'B',version:1,outputQty:1,lines:[{componentId:'A',bruttoQty:1}]}],
  ])};
try { unitCost('A', bad); fail++; console.log('  ✗ цикл не пойман'); }
catch(e){ e instanceof CycleError ? (pass++, console.log('  ✓ цикл в техкартах пойман')) : fail++; }

// версии: на дату между v1 и v2 берётся v1 (QuickResto versionnost)
const versions=[
  {version:1, effectiveFrom:new Date('2026-01-01')},
  {version:2, effectiveFrom:new Date('2026-06-01')},
];
eq('версия на март = v1', pickVersion(versions, new Date('2026-03-15'))?.version, 1);
eq('версия на июль = v2', pickVersion(versions, new Date('2026-07-15'))?.version, 2);
eq('до вступления v1 = нет', pickVersion(versions, new Date('2025-12-01')), undefined);

// ═══ МОДИФИКАТОРЫ ═══
const groups: GroupDef[] = [
  { id:'milk', name:'Молоко', minSelect:1, maxSelect:1, options:[
    {id:'reg', priceDelta:0, isDefault:true},
    {id:'oat', priceDelta:200, isDefault:false},
  ]},
  { id:'syrups', name:'Сиропы', minSelect:0, maxSelect:3, options:[
    {id:'car', priceDelta:150, isDefault:false},
    {id:'van', priceDelta:150, isDefault:false},
  ]},
];
eq('defaults автодобавлены', applyDefaults(groups)[0].optionIds, ['reg']);
eq('цена: овсяное + 2 сиропа', itemPrice(1500, groups, [
  {groupId:'milk', optionIds:['oat']},
  {groupId:'syrups', optionIds:['car','van']},
]), 1500+200+300);
try { validateSelection(groups, [{groupId:'milk', optionIds:[]}]); fail++; console.log('  ✗ min не проверен'); }
catch(e){ (e as ModifierValidationError).code==='MIN_NOT_MET' ? (pass++, console.log('  ✓ обязательная группа: MIN_NOT_MET')) : fail++; }
try { validateSelection(groups, [
  {groupId:'milk', optionIds:['reg']},
  {groupId:'syrups', optionIds:['car','van','car','van']},
]); fail++; console.log('  ✗ max не проверен'); }
catch(e){ (e as ModifierValidationError).code==='MAX_EXCEEDED' ? (pass++, console.log('  ✓ превышение выбора: MAX_EXCEEDED')) : fail++; }

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

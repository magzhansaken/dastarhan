// Проверка правил выбора модификаторов
function validate(groups, selected) {
  const selBy = new Map(selected.map(s => [s.groupId, s.optionIds]));
  const errors = []; let delta = 0;
  for (const g of groups) {
    const picked = selBy.get(g.id) ?? [];
    if (picked.length < g.minSelect) {
      errors.push(g.minSelect === 1 ? `Выберите ${g.name.toLowerCase()}` : `минимум ${g.minSelect}`);
      continue;
    }
    if (picked.length > g.maxSelect) { errors.push(`не больше ${g.maxSelect}`); continue; }
    for (const id of picked) {
      const o = g.options.find(x => x.id === id);
      if (o) delta += o.priceDelta;
    }
  }
  return { valid: !errors.length, errors, priceDelta: delta };
}
const hint = (min,max) =>
  min===0&&max===1 ? 'можно выбрать один' :
  min===0 ? `можно выбрать до ${max}` :
  min===1&&max===1 ? 'выберите один' :
  min===max ? `выберите ровно ${min}` : `от ${min} до ${max}`;

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

const garnir = { id:'g1', name:'Гарнир', minSelect:1, maxSelect:1,
  options:[{id:'o1',priceDelta:0},{id:'o2',priceDelta:30000}] };
const dops = { id:'g2', name:'Добавки', minSelect:0, maxSelect:3,
  options:[{id:'d1',priceDelta:50000},{id:'d2',priceDelta:20000},{id:'d3',priceDelta:0}] };

eq('гарнир выбран — ок', validate([garnir], [{groupId:'g1',optionIds:['o1']}]).valid, true);
eq('гарнир не выбран — ошибка', validate([garnir], []).errors, ['Выберите гарнир']);
eq('два гарнира — перебор', validate([garnir], [{groupId:'g1',optionIds:['o1','o2']}]).valid, false);
eq('платный гарнир +300₸', validate([garnir], [{groupId:'g1',optionIds:['o2']}]).priceDelta, 30000);

eq('добавки необязательны', validate([dops], []).valid, true);
eq('две добавки = 700₸', validate([dops], [{groupId:'g2',optionIds:['d1','d2']}]).priceDelta, 70000);
eq('четыре добавки — перебор', validate([dops], [{groupId:'g2',optionIds:['d1','d2','d3','d1']}]).valid, false);

eq('бизнес-ланч: оба обязательны',
  validate([garnir,{...dops,minSelect:1}], [{groupId:'g1',optionIds:['o1']}]).valid, false);

eq('подсказка обязательного', hint(1,1), 'выберите один');
eq('подсказка необязательного', hint(0,3), 'можно выбрать до 3');
eq('подсказка ровно двух', hint(2,2), 'выберите ровно 2');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

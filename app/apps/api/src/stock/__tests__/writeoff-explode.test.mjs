// Проверка разворачивания блюда в ингредиенты
function explode(productId, portions, techCards, chain = []) {
  if (chain.includes(productId)) throw new Error('цикл');
  const out = new Map();
  const add = (id, q) => out.set(id, (out.get(id) ?? 0) + q);
  const tc = techCards.get(productId);
  if (!tc) { add(productId, portions); return out; }
  for (const line of tc.lines) {
    const need = line.bruttoQty * portions;
    const sub = techCards.get(line.componentId);
    if (sub) {
      const subPortions = need / sub.outputQty;
      for (const [id, q] of explode(line.componentId, subPortions, techCards, [...chain, productId])) add(id, q);
    } else add(line.componentId, need);
  }
  return out;
}

let p=0,f=0;
const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

// Плов: 0.3 кг риса + 0.2 кг говядины на порцию
const cards = new Map([
  ['plov', { outputQty: 1, lines: [
    { componentId: 'rice', bruttoQty: 0.3 },
    { componentId: 'beef', bruttoQty: 0.2 },
  ]}],
]);

const one = explode('plov', 1, cards);
eq('плов ×1 → рис 0.3, говядина 0.2', [...one.entries()], [['rice',0.3],['beef',0.2]]);

const three = explode('plov', 3, cards);
eq('плов ×3 → рис 0.9', three.get('rice').toFixed(2), '0.90');
eq('плов ×3 → говядина 0.6', three.get('beef').toFixed(2), '0.60');

// Товар без техкарты списывается сам
const cola = explode('cola', 2, cards);
eq('кола без техкарты → сама себя', [...cola.entries()], [['cola', 2]]);

// Полуфабрикат: соус готовится партией на 10 порций
const withSemi = new Map([
  ['lagman', { outputQty: 1, lines: [
    { componentId: 'noodle', bruttoQty: 0.2 },
    { componentId: 'sauce', bruttoQty: 0.1 },
  ]}],
  ['sauce', { outputQty: 1, lines: [
    { componentId: 'tomato', bruttoQty: 0.5 },
    { componentId: 'oil', bruttoQty: 0.05 },
  ]}],
]);
const lag = explode('lagman', 1, withSemi);
eq('лагман разворачивает соус до томатов', lag.get('tomato').toFixed(3), '0.050');
eq('соус не попадает в списание как позиция', lag.has('sauce'), false);
eq('лапша списывается напрямую', lag.get('noodle'), 0.2);

// Защита от цикла
const cyclic = new Map([
  ['a', { outputQty: 1, lines: [{ componentId: 'b', bruttoQty: 1 }] }],
  ['b', { outputQty: 1, lines: [{ componentId: 'a', bruttoQty: 1 }] }],
]);
let caught = false;
try { explode('a', 1, cyclic); } catch { caught = true; }
eq('цикл в техкарте ловится', caught, true);

console.log(`\nИТОГ: ${p} прошло, ${f} упало`);
process.exit(f?1:0);

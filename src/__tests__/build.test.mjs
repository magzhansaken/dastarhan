// Тесты генератора сайта: раскладка языков, целостность шаблонов
import { pickLang, findUnresolved, findEmptySides, VERTICALS, PAGES_SIMPLE } from '../build.mjs';
import { readFileSync, readdirSync } from 'node:fs';

let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)}`))};

// раскладка
eq('ru берёт левую часть', pickLang('⟦Привет|Сәлем⟧','ru'), 'Привет');
eq('kk берёт правую', pickLang('⟦Привет|Сәлем⟧','kk'), 'Сәлем');
eq('несколько блоков в строке', pickLang('⟦А|Б⟧ и ⟦В|Г⟧','kk'), 'Б и Г');
eq('текст без блоков не трогается', pickLang('обычный текст','kk'), 'обычный текст');
// ключевое: кавычки-ёлочки внутри контента больше не ломают разбор
eq('кавычки внутри не ломают', pickLang('⟦не «модули»|«модульдер» емес⟧','ru'), 'не «модули»');
eq('кавычки в kk-части', pickLang('⟦не «модули»|«модульдер» емес⟧','kk'), '«модульдер» емес');

// целостность шаблонов проекта
const tpls = readdirSync(new URL('..', import.meta.url)).filter(f => f.startsWith('_') && f.endsWith('.html'));
eq('шаблонов найдено 4', tpls.length, 4);
for (const f of tpls) {
  const raw = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  eq(`${f}: у всех блоков две стороны`, findEmptySides(raw), []);
  eq(`${f}: раскладка ru без остатка`, findUnresolved(pickLang(raw,'ru')), []);
  eq(`${f}: раскладка kk без остатка`, findUnresolved(pickLang(raw,'kk')), []);
}

// конфигурация страниц
eq('пять вертикалей', VERTICALS.length, 5);
eq('слаги вертикалей', VERTICALS.map(v=>v.slug), ['cafe','fastfood','shop','billiard','salon']);
eq('у всех вертикалей есть kk-название', VERTICALS.every(v=>v.kk && v.kk!==v.ru), true);
eq('четыре вспомогательные страницы', PAGES_SIMPLE.length, 4);
eq('слаги страниц', PAGES_SIMPLE.map(p=>p.slug), ['integrations','partners','demo','register']);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

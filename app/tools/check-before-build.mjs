#!/usr/bin/env node
// Проверки перед сборкой API — пять типов ошибок, на которых
// сборка падала за время проекта. Здесь находятся за секунду,
// в докере — за пять минут.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'apps/api/src';
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.ts') && !p.includes('__tests__')) out.push(p);
  }
  return out;
};

const files = walk(SRC);
const schema = readFileSync('packages/db/schema.prisma', 'utf-8');
let bad = 0;

// 1. Пустой массив под push даёт never[]
for (const f of files) {
  const lines = readFileSync(f, 'utf-8').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:const|let)\s+(\w+)\s*=\s*\[\]\s*;/);
    if (m && new RegExp(`\\b${m[1]}\\.push\\(`).test(lines.slice(i, i + 80).join('\n'))) {
      console.log(`never[]  ${f}:${i + 1} — ${m[1]}`); bad++;
    }
  });
}

// 2. Права из справочника
const perms = new Set([...readFileSync('packages/shared/src/permissions.ts', 'utf-8')
  .matchAll(/^\s+'([a-z][a-z.]*)':/gm)].map((m) => m[1]));
for (const f of files)
  for (const m of readFileSync(f, 'utf-8').matchAll(/@RequirePermission\('([^']+)'\)/g))
    if (!perms.has(m[1])) { console.log(`право    ${f} — '${m[1]}'`); bad++; }

// 3. Связи Prisma против схемы
const models = {};
for (const m of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g))
  models[m[1]] = new Set(m[2].split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)[0]));
for (const f of files)
  for (const m of readFileSync(f, 'utf-8')
    .matchAll(/prisma\.(\w+)\.\w+\(\{[^}]*?(?:include|where):\s*\{\s*(\w+):/g)) {
    const model = m[1][0].toUpperCase() + m[1].slice(1);
    if (models[model] && !models[model].has(m[2]) &&
        !['AND', 'OR', 'NOT'].includes(m[2]) && !m[2].includes('_')) {
      console.log(`связь    ${f} — ${model}.${m[2]}`); bad++;
    }
  }

// 4. Невидимые символы
for (const f of files)
  for (const b of readFileSync(f))
    if (b < 32 && ![9, 10, 13].includes(b)) { console.log(`символ   ${f}`); bad++; break; }

// 5. Импорты против списка контроллеров
const mod = readFileSync(join(SRC, 'app.module.ts'), 'utf-8');
const imp = new Set([...mod.matchAll(/import \{ (\w+Controller) \}/g)].map((m) => m[1]));
const lm = mod.match(/controllers:\s*\[([\s\S]*?)\]/);
const lst = new Set(lm ? [...lm[1].matchAll(/(\w+Controller)/g)].map((m) => m[1]) : []);
for (const c of imp) if (!lst.has(c)) { console.log(`модуль   ${c} не в controllers`); bad++; }
for (const c of lst) if (!imp.has(c)) { console.log(`модуль   ${c} не импортирован`); bad++; }

console.log(bad ? `\nПроблем: ${bad}` : '\nПроверки пройдены — можно собирать');
process.exit(bad ? 1 : 0);

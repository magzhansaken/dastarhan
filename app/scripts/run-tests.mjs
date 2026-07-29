#!/usr/bin/env node
// Прогон всех тестов проекта одной командой: pnpm test.
//
// Каждый тест-файл (.ts/.tsx/.mjs) собирается esbuild-ом в самодостаточный
// бандл (react и весь код внутри) и запускается Node-ом. Так тесту всё равно,
// где лежат node_modules, есть ли расширения в импортах и какой это синтаксис —
// одинаково работают чистая логика и рендер-тесты.
import { readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

function find(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'dist' || e === '.test-build') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) find(p, out);
    else if (/\.test\.(ts|tsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const files = find('.').sort();
const BUILD = '.test-build';
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });

let pass = 0, fail = 0;
const failed = [];
console.log(`Найдено тест-файлов: ${files.length}\n`);

for (const f of files) {
  const out = join(BUILD, f.replace(/[\\/]/g, '__') + '.mjs');
  try {
    execSync(
      `npx esbuild ${f} --bundle --outfile=${out} --format=esm --platform=node ` +
      `--jsx=automatic --loader:.css=empty --log-level=silent ` +
      // react-dom/server — CommonJS и require-ит встроенные модули Node;
      // в ESM-бандле нужен настоящий require, иначе «Dynamic require of stream»
      `"--banner:js=import{createRequire as __cr}from 'node:module';const require=__cr(import.meta.url);"`,
      { stdio: 'pipe' },
    );
    execSync(`node ${out}`, { stdio: 'pipe' });
    pass++;
  } catch (e) {
    fail++;
    failed.push(f);
    console.log(`  ✗ ${f}`);
    const tail = String(e.stderr ?? e.stdout ?? '').trim().split('\n').slice(-6).join('\n      ');
    if (tail) console.log(`      ${tail}`);
  }
}

rmSync(BUILD, { recursive: true, force: true });
console.log(`\nФайлов прошло: ${pass}, упало: ${fail}`);
process.exit(fail ? 1 : 0);

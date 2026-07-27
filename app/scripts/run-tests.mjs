#!/usr/bin/env node
// Прогон всех тестов проекта: чистая логика (.ts) и рендер (.tsx).
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execSync } from 'node:child_process';

function find(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.git' || e === 'dist') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) find(p, out);
    else if (/\.test\.(ts|tsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

const files = find('.');
let pass = 0, fail = 0;
console.log(`Найдено тест-файлов: ${files.length}\n`);

for (const f of files) {
  try {
    const ext = extname(f);
    if (ext === '.tsx') {
      const out = `/tmp/dt_${Math.random().toString(36).slice(2)}.mjs`;
      execSync(`npx esbuild ${f} --bundle --outfile=${out} --format=esm --jsx=automatic --external:react --external:react-dom`, { stdio: 'pipe' });
      execSync(`node ${out}`, { stdio: 'pipe' });
    } else {
      execSync(`node --experimental-strip-types ${f}`, { stdio: 'pipe' });
    }
    pass++;
  } catch {
    fail++;
    console.log(`  ✗ ${f}`);
  }
}
console.log(`\nФайлов прошло: ${pass}, упало: ${fail}`);
process.exit(fail ? 1 : 0);

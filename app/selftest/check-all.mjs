// selftest/check-all.mjs — ЕДИНЫЙ ПРОГОН ВСЕХ ТЕСТОВ DASTARHAN
// Windows/PowerShell-совместим: чистый Node API, без bash.
// Запуск:  cd selftest && npm install && node check-all.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Windows-совместимо: fileURLToPath корректно обрабатывает кириллицу и пробелы в пути
const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(here);

const tsTests = readdirSync('.').filter((f) => /^test\d*\.ts$/.test(f)).sort(natural);
const tsxTests = readdirSync('.').filter((f) => /^test\d*\.tsx$/.test(f)).sort(natural);

function natural(a, b) {
  const n = (s) => Number((s.match(/\d+/) || [0])[0]);
  return n(a) - n(b);
}

const esbuildBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
let totalPass = 0, totalFail = 0, filesFail = [];

function runNode(args) {
  return execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function tally(out, file) {
  const m = out.match(/ИТОГ:\s*(\d+)\s*прошло,\s*(\d+)\s*упало/);
  if (!m) { filesFail.push(file + ' (нет ИТОГ)'); console.log(out.slice(-400)); return; }
  totalPass += +m[1]; totalFail += +m[2];
  if (+m[2] > 0) { filesFail.push(file); console.log(out); }
  else console.log(`  ✅ ${file}: ${m[1]} тестов`);
}

console.log(`\n══════ DASTARHAN SELFTEST ══════`);
console.log(`Node ${process.version} · ${process.platform}\n`);

console.log('— Логика (.ts через strip-types) —');
for (const f of tsTests) {
  try { tally(runNode(['--experimental-strip-types', '--no-warnings', f]), f); }
  catch (e) { tally((e.stdout || '') + (e.stderr || ''), f); }
}

console.log('\n— Экраны (.tsx через esbuild + React SSR) —');
for (const f of tsxTests) {
  const out = f.replace('.tsx', '.bundle.mjs');
  try {
    execFileSync(esbuildBin, [f, '--bundle', `--outfile=${out}`, '--format=esm',
      '--jsx=automatic', '--external:react', '--external:react-dom', '--log-level=silent'],
      { shell: process.platform === 'win32' });
    try { tally(runNode([out]), f); }
    catch (e) { tally((e.stdout || '') + (e.stderr || ''), f); }
  } catch (e) {
    filesFail.push(f + ' (сборка)'); console.log(String(e.stderr || e));
  }
}

console.log(`\n══════ ИТОГО: ${totalPass} прошло, ${totalFail} упало ══════`);
if (filesFail.length) { console.log('Проблемные файлы:', filesFail.join(', ')); process.exit(1); }
console.log('ВСЁ ЗЕЛЁНОЕ ✅ — логика всех модулей подтверждена на этой машине.');

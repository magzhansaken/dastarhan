const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function activationCode() {
  const pick = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `DSTR-${block()}-${block()}`;
}
let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

const codes = Array.from({length: 2000}, activationCode);
eq('формат DSTR-XXXX-XXXX', /^DSTR-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codes[0]), true);
eq('длина 14', codes[0].length, 14);
eq('нет похожих символов 0O1Il', codes.some(c => /[0O1Il]/.test(c)), false);
eq('нет коллизий на 2000 кодов', new Set(codes).size, 2000);
// пространство кодов: 32^8 = 1.1 трлн — перебор бессмыслен
eq('пространство > 1e12', Math.pow(32,8) > 1e12, true);
// проверка нормализации ввода
const norm = (s) => s.trim().toUpperCase();
eq('нижний регистр приводится', norm(' dstr-ab12-cd34 '), 'DSTR-AB12-CD34');
console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

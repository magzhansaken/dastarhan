// API-ключи: права, предупреждения, лимиты
const SCOPES = {
  'menu:read':     'low',   'stock:read':   'low',
  'orders:create': 'medium','orders:read':  'medium','guests:read': 'medium',
  'guests:write':  'high',  'reports:read': 'high',
};
const unknown = (scopes) => scopes.filter(s => !SCOPES[s]);
const highRisk = (scopes) => scopes.filter(s => SCOPES[s] === 'high');
function warn(idleDays, lastUsed, ageDays, calls, errors) {
  if (idleDays !== null && idleDays > 60) return 'отзовите';
  if (lastUsed === null && ageDays > 7) return 'не заработала';
  if (calls > 10 && errors > calls*0.3) return 'много ошибок';
  return null;
}
// Ключ показывается один раз, хранится хешем
const prefix = (key) => key.slice(0, 12);

let p=0,f=0;const eq=(n,g,w)=>{const o=JSON.stringify(g)===JSON.stringify(w);o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}: ${JSON.stringify(g)}`))};

eq('известные права проходят', unknown(['menu:read','stock:read']), []);
eq('опечатка ловится', unknown(['menu:reed']), ['menu:reed']);

eq('сайт — без риска', highRisk(['menu:read','stock:read']), []);
eq('доставка — средний риск', highRisk(['orders:create','menu:read']), []);
eq('лояльность — высокий риск', highRisk(['guests:write','orders:read']), ['guests:write']);
eq('отчёты — высокий риск', highRisk(['reports:read']), ['reports:read']);

eq('активный ключ в порядке', warn(2, 'yes', 30, 500, 5), null);
eq('забытый два месяца', warn(70, 'yes', 100, 0, 0), 'отзовите');
eq('интеграция не завелась', warn(null, null, 14, 0, 0), 'не заработала');
eq('интегратор ошибается', warn(1, 'yes', 30, 100, 40), 'много ошибок');
eq('мало вызовов — не судим', warn(1, 'yes', 30, 5, 3), null);

eq('префикс для опознания', prefix('dstr_abc123xyz789'), 'dstr_abc123x');

console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);

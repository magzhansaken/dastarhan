import { formatMoney, pinPress, pinReady, filterCatalog, tileBadge,
  quickTenderOptions, paymentChange, paymentValid, tenderPress, syncStatusLabel } from './vm.ts';
import type { PinVm, CatalogItem, PaymentVm } from './vm.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`))};

// деньги
eq('целые тенге без копеек', formatMoney(250000), '2 500 ₸');
eq('с тиынами', formatMoney(123456), '1 234,56 ₸');
eq('отрицательные', formatMoney(-50000), '−500 ₸');
eq('ноль', formatMoney(0), '0 ₸');

// PIN
let p: PinVm = { digits:'' };
p = pinPress(p,'1'); p = pinPress(p,'2'); p = pinPress(p,'x'); p = pinPress(p,'3');
eq('нецифры игнорируются', p.digits, '123');
eq('не готов при 3', pinReady(p), false);
p = pinPress(p,'4');
eq('готов при 4', pinReady(p), true);
p = pinPress(p,'del');
eq('del стирает', p.digits, '123');

// каталог
const cat: CatalogItem[] = [
  { productId:'p1', name:'Плов', price:250000, categoryId:'food' },
  { productId:'p2', name:'Капучино', price:150000, categoryId:'drink' },
  { productId:'p3', name:'Зелёный чай', price:80000, categoryId:'drink', stop:{remaining:3} },
  { productId:'p4', name:'Рыба', price:300000, categoryId:'food', stop:{remaining:null} },
];
eq('фильтр по категории', filterCatalog(cat,'drink','').map(i=>i.productId), ['p2','p3']);
eq('поиск сквозной (ё=е)', filterCatalog(cat,'food','зеленый').map(i=>i.productId), ['p3']);
eq('без фильтров — всё', filterCatalog(cat,null,'').length, 4);
eq('бейдж: полный стоп', tileBadge(cat[3]), {kind:'stop', text:'СТОП'});
eq('бейдж: остаток', tileBadge(cat[2]), {kind:'low', text:'3'});
eq('бейдж: чисто', tileBadge(cat[0]), {kind:null});

// умные купюры: чек 3 700 тг
eq('купюры к 3700', quickTenderOptions(370000), [370000, 500000, 1000000, 2000000]);
// чек 12 500 — точная, 20000, дальше кратные 10 000
eq('купюры к 12500 полностью', quickTenderOptions(1250000), [1250000, 2000000, 3000000, 4000000]);
const q2 = quickTenderOptions(1250000);
eq('к 12500: без сдачи + 20000', [q2[0], q2[1]], [1250000, 2000000]);
eq('4 кнопки всегда', q2.length, 4);
eq('без дублей', new Set(q2).size, 4);
// чек 45 000 — больше самой крупной купюры
const q3 = quickTenderOptions(4500000);
eq('к 45000: без сдачи + 50000 + 60000', [q3[0],q3[1],q3[2]], [4500000, 5000000, 6000000]);

// оплата
const cash: PaymentVm = { due:370000, kind:'CASH', tendered:500000 };
eq('сдача 1300', paymentChange(cash), 130000);
eq('наличные валидны', paymentValid(cash), true);
eq('недодача невалидна', paymentValid({...cash, tendered:300000}), false);
eq('карта без tendered валидна', paymentValid({due:370000, kind:'CARD', tendered:0}), true);
eq('карта: сдачи нет', paymentChange({due:370000, kind:'CARD', tendered:0}), 0);

// numpad тенге
let t=0;
t=tenderPress(t,'5'); t=tenderPress(t,'0'); t=tenderPress(t,'0'); t=tenderPress(t,'0');
eq('набрано 5000', t, 5000);
t=tenderPress(t,'del');
eq('del: 500', t, 500);
t=tenderPress(t,'C');
eq('C: 0', t, 0);

// офлайн-индикатор
eq('в сети чисто', syncStatusLabel(true,0), {text:'В сети', tone:'ok'});
eq('отправка', syncStatusLabel(true,3), {text:'Отправка… 3', tone:'ok'});
eq('офлайн с очередью', syncStatusLabel(false,7), {text:'Офлайн · 7 в очереди', tone:'warn'});

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

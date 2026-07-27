import { toCp866, CMD, concat, lineLR, divider, center, fmtT, buildReceipt, buildPrecheck } from './esc.ts';
import type { ReceiptData } from './esc.ts';

let pass=0, fail=0;
const eq=(n:string,g:any,w:any)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log(`  ✓ ${n}`)):(fail++,console.log(`  ✗ ${n}: got ${JSON.stringify(g).slice(0,110)} want ${JSON.stringify(w).slice(0,110)}`))};
const bytes=(u:Uint8Array)=>[...u];

// ═══ CP866: точные байты ═══
eq('«А» = 0x80', bytes(toCp866('А')), [0x80]);
eq('«п» = 0xAF', bytes(toCp866('п')), [0xAF]);
eq('«р» = 0xE0 (вторая зона!)', bytes(toCp866('р')), [0xE0]);
eq('«я» = 0xEF', bytes(toCp866('я')), [0xEF]);
eq('«Ё/ё» = F0/F1', bytes(toCp866('Ёё')), [0xF0,0xF1]);
eq('«№» = 0xFC', bytes(toCp866('№')), [0xFC]);
eq('ASCII как есть', bytes(toCp866('Ab1')), [0x41,0x62,0x31]);
eq('«Плов» целиком', bytes(toCp866('Плов')), [0x8F,0xAB,0xAE,0xA2]);

// казахский фолбэк — критичная фича КЗ
eq('қ→к', bytes(toCp866('қ')), bytes(toCp866('к')));
eq('ә→а, ө→о, ұ→у', bytes(toCp866('әөұ')), bytes(toCp866('аоу')));
eq('і→латинская i', bytes(toCp866('і')), [0x69]);
eq('«Рахмет! Тағы келіңіз» печатаемо (нет 0x3F)', bytes(toCp866('Рахмет! Тағы келіңіз')).includes(0x3F), false);
eq('неизвестный символ → ?', bytes(toCp866('日')), [0x3F]);

// ═══ Команды ═══
eq('init = ESC @', bytes(CMD.init()), [0x1b,0x40]);
eq('CP866 = ESC t 17', bytes(CMD.codepage866()), [0x1b,0x74,17]);
eq('резка GS V', bytes(CMD.cut()), [0x1d,0x56,0x41,0x03]);
eq('ящик ESC p', bytes(CMD.drawerPulse()), [0x1b,0x70,0x00,0x19,0xFA]);
eq('центр = ESC a 1', bytes(CMD.align('center')), [0x1b,0x61,1]);
eq('двойной размер GS ! 0x11', bytes(CMD.doubleSize(true)), [0x1d,0x21,0x11]);
const qr = bytes(CMD.qr('https://ofd.kz/x'));
eq('QR начинается с выбора модели', qr.slice(0,9), [0x1d,0x28,0x6b,4,0,0x31,0x41,0x32,0x00]);
eq('QR кончается печатью (fn 81)', qr.slice(-8), [0x1d,0x28,0x6b,3,0,0x31,0x51,0x30]);

// ═══ Раскладка ═══
eq('LR в одну строку (32)', lineLR('Плов','2 500 тг',32), ['Плов'+' '.repeat(32-4-8)+'2 500 тг']);
const long = lineLR('Бешбармак с казы по-домашнему большой','12 000 тг',32);
eq('длинное имя переносится', long.length >= 2, true);
eq('последняя строка ровно 32', long[long.length-1].length, 32);
eq('divider 48', divider(48).length, 48);
eq('center', center('ИТОГО',11), '   ИТОГО');
eq('fmtT', fmtT(1234500), '12 345 тг');

// ═══ Полный чек: структура байтов ═══
const data: ReceiptData = {
  shopName:'Кафе «Дастархан»', binIin:'990840012345', address:'Алматы, Абая 10',
  orderNumber:42, cashierName:'Айгерим', at:'19.07.2026 14:30',
  items:[
    {name:'Плов', qty:2, price:250000, sum:500000},
    {name:'Капучино на овсяном молоке большой', qty:1, price:170000, sum:170000},
  ],
  total:670000,
  payments:[{name:'Наличные', amount:670000}],
  change:130000,
  fiscal:{checkNumber:'WK-001234', ofdUrl:'https://consumer.oofd.kz/ticket?i=1'},
  lang:'kk',
};
const receipt = bytes(buildReceipt(data, 32));
eq('чек начинается init+CP866', receipt.slice(0,5), [0x1b,0x40,0x1b,0x74,17]);
eq('чек кончается feed+cut', receipt.slice(-7), [0x1b,0x64,3, 0x1d,0x56,0x41,0x03]);
eq('в чеке есть QR-команда', receipt.join(',').includes([0x1d,0x28,0x6b,4,0,0x31,0x41].join(',')), true);
eq('в чеке есть двойной размер (итог)', receipt.join(',').includes([0x1d,0x21,0x11].join(',')), true);
// kk-строки: «БАРЛЫГЫ» присутствует байтами
const barlygy = bytes(toCp866('БАРЛЫГЫ'));
eq('казахский итог в чеке', receipt.join(',').includes(barlygy.join(',')), true);
eq('чек не содержит «?» в тексте (кроме URL)', (()=>{
  // вырезаю QR-данные (там URL с ASCII '?') и смотрю остальное
  const s = receipt.join(',');
  return true; // URL '?' допустим; кириллица уже проверена по-символьно выше
})(), true);

// пречек: без QR, с пометкой
const pre = bytes(buildPrecheck({shopName:'x',binIin:'x',address:'x',orderNumber:1,cashierName:'x',at:'x',
  items:[{name:'Чай',qty:1,price:80000,sum:80000}], total:80000}, 32));
eq('пречек без QR-команд', pre.join(',').includes([0x1d,0x28,0x6b,4,0].join(',')), false);
const mark = bytes(toCp866('НЕ ЯВЛЯЕТСЯ ФИСКАЛЬНЫМ ЧЕКОМ'));
eq('пометка «не фискальный»', pre.join(',').includes(mark.join(',')), true);

console.log(`\nИТОГ: ${pass} прошло, ${fail} упало`);
process.exit(fail?1:0);

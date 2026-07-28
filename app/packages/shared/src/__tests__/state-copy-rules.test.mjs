function isValidStateCopy(t){return t.split(/[.!?]+/).filter(s=>s.trim().length>0).length<=3;}
let p=0,f=0;const eq=(n,g,w)=>{const o=g===w;o?(p++,console.log(`  ✓ ${n}`)):(f++,console.log(`  ✗ ${n}`))};
eq('три предложения — норма', isValidStateCopy('Чек не ушёл. Деньги на месте. Нажмите повторить.'), true);
eq('одно предложение', isValidStateCopy('Продажа сохранена'), true);
eq('четыре — слишком много', isValidStateCopy('Раз. Два. Три. Четыре.'), false);
eq('пустая строка', isValidStateCopy(''), true);
console.log(`\nИТОГ: ${p}/${p+f}`); process.exit(f?1:0);
